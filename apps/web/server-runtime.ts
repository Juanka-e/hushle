import { createServer } from "http";
import next from "next";
import { Server } from "socket.io";
import { getToken } from "next-auth/jwt";
import { fileURLToPath } from "node:url";
import {
    setupGameSocket,
    getLocalRoomCapacityMetrics,
    getRoomMetrics,
} from "./src/lib/socket/game-socket";
import { isHealthEndpointAllowed } from "./src/lib/security/health-check";
import { getPaymentSchedulerHealth } from "./src/lib/payments/scheduler-health";
import { getPaymentCheckoutControl } from "./src/lib/payments/checkout-control";
import { closeRedisClient, getRedisHealth } from "@hushle/platform-cache";
import {
    allowOriginlessSocketClients,
    isTrustedWebOrigin,
    parseTrustedWebOrigins,
} from "./src/lib/security/web-origin-policy";
import {
    getCapacityInstanceId,
    publishCapacityHeartbeat,
    removeCapacityHeartbeat,
} from "./src/lib/socket/room-capacity";
import {
    configureSocketRedisAdapter,
    getSocketRedisAdapterConfig,
    type SocketRedisAdapterHandle,
} from "./src/lib/socket/socket-redis-adapter";
import {
    createRoomOwnershipCoordinator,
    getRoomOwnershipConfig,
    type RoomOwnershipCoordinator,
} from "./src/lib/socket/room-ownership";
import {
    createRoomRouteResolver,
    type RoomRouteResolver,
} from "./src/lib/socket/room-routing";
import {
    getRealtimeTopologyConfig,
    getRealtimeTopologyStatus,
} from "./src/lib/socket/realtime-topology";
import {
    getTelemetryRollupConfig,
    getTelemetryRollupStatus,
} from "./src/lib/security/telemetry-rollup";
import { getProductAnalyticsStatus } from "./src/lib/analytics/product-events";
import { getWordAnalyticsStatus } from "./src/lib/analytics/word-analytics";
import {
    emitObservabilityEvent,
    flushObservabilityExporter,
    getObservabilityStatus,
    getOrCreateRequestId,
    reportError,
    reportWarning,
} from "@hushle/platform-observability";

const appDirectory = fileURLToPath(new URL(".", import.meta.url));
process.chdir(appDirectory);

const dev = process.env.NODE_ENV !== "production";
const hostname = process.env.HOST || (dev ? "localhost" : "127.0.0.1");
const port = parseInt(process.env.PORT || "3000", 10);
const trustedWebOrigins = parseTrustedWebOrigins();
const realtimeTopologyConfig = getRealtimeTopologyConfig();
const realtimeTopologyStatus = getRealtimeTopologyStatus(
    realtimeTopologyConfig
);
const telemetryRollupConfig = getTelemetryRollupConfig();

const app = next({ dev, hostname, port, dir: appDirectory });
const handler = app.getRequestHandler();

app.prepare().then(async () => {
    let socketRedisAdapter: SocketRedisAdapterHandle | null = null;
    let roomOwnership: RoomOwnershipCoordinator | null = null;
    let roomRouting: RoomRouteResolver | null = null;
    const socketRedisAdapterConfig = getSocketRedisAdapterConfig();
    const roomOwnershipConfig = getRoomOwnershipConfig();
    const httpServer = createServer(async (req, res) => {
        const incomingRequestId = req.headers["x-request-id"];
        const requestId = getOrCreateRequestId(
            typeof incomingRequestId === "string"
                ? incomingRequestId
                : undefined
        );
        req.headers["x-request-id"] = requestId;
        res.setHeader("X-Request-Id", requestId);

        if (req.url !== "/api/health" || req.method !== "GET") {
            await handler(req, res);
            return;
        }

        const requestHeaders = new Headers();
        for (const [key, value] of Object.entries(req.headers)) {
            if (typeof value === "string") {
                requestHeaders.set(key, value);
            } else if (Array.isArray(value)) {
                requestHeaders.set(key, value.join(", "));
            }
        }

        if (!isHealthEndpointAllowed(requestHeaders, dev)) {
            res.writeHead(404, { "Content-Type": "application/json" });
            res.end(JSON.stringify({ error: "Not found" }));
            return;
        }

        const metrics = getRoomMetrics();
        const paymentsEnabled = process.env.PAYMENTS_ENABLED?.trim().toLowerCase() === "true";
        const [redis, paymentSchedulers, paymentCheckoutControl] = await Promise.all([
            getRedisHealth(),
            getPaymentSchedulerHealth(),
            paymentsEnabled
                ? getPaymentCheckoutControl().catch(() => null)
                : Promise.resolve(null),
        ]);
        const socketRedisAdapterStatus =
            socketRedisAdapter?.getStatus() ?? {
                enabled: socketRedisAdapterConfig.enabled,
                available: false,
                redisConfigured: socketRedisAdapterConfig.redisConfigured,
                stickySessionsConfigured:
                    socketRedisAdapterConfig.stickySessionsConfigured,
                roomStateBackend: "process-local" as const,
                multiInstanceReady: false as const,
            };
        const roomOwnershipStatus = roomOwnership?.getStatus() ?? {
            enabled: roomOwnershipConfig.enabled,
            available: false,
            instanceId: getCapacityInstanceId(),
            leaseTtlMs: roomOwnershipConfig.leaseTtlMs,
            renewIntervalMs: roomOwnershipConfig.renewIntervalMs,
            trackedRooms: 0,
            ownedRooms: 0,
            lostRooms: 0,
            claimConflicts: 0,
            lostOwnerships: 0,
            renewFailures: 0,
            lastRenewedAt: null,
            enforcement: "create-only" as const,
        };
        const roomRoutingStatus = roomRouting?.getStatus() ?? {
            enabled: roomOwnershipConfig.enabled,
            available: false,
            mode: "observe-and-reject" as const,
            routingReady: false as const,
            decisions: 0,
            localDecisions: 0,
            missingDecisions: 0,
            remoteOwnerRequests: 0,
            localStateMissing: 0,
            ownershipMismatches: 0,
            lookupFailures: 0,
            lastDecisionAt: null,
        };
        const realtimeDegraded =
            (socketRedisAdapterStatus.enabled &&
                !socketRedisAdapterStatus.available) ||
            (roomOwnershipStatus.enabled && !roomOwnershipStatus.available) ||
            roomOwnershipStatus.lostRooms > 0 ||
            (roomRoutingStatus.enabled && !roomRoutingStatus.available) ||
            roomRoutingStatus.remoteOwnerRequests > 0 ||
            roomRoutingStatus.localStateMissing > 0 ||
            roomRoutingStatus.ownershipMismatches > 0;
        const paymentSchedulersDegraded =
            paymentsEnabled
            && paymentSchedulers.some((scheduler) => scheduler.status !== "healthy");
        const paymentCheckoutControlDegraded = paymentsEnabled
            && (!paymentCheckoutControl || !paymentCheckoutControl.available);
        res.writeHead(200, { "Content-Type": "application/json" });
        res.end(
            JSON.stringify({
                status: realtimeDegraded || paymentSchedulersDegraded || paymentCheckoutControlDegraded
                    ? "degraded"
                    : "ok",
                uptime: process.uptime(),
                dependencies: {
                    redis,
                },
                realtime: {
                    topology: realtimeTopologyStatus,
                    socketRedisAdapter: socketRedisAdapterStatus,
                    roomOwnership: roomOwnershipStatus,
                    roomRouting: roomRoutingStatus,
                },
                telemetry: {
                    matchFinalize:
                        getTelemetryRollupStatus(telemetryRollupConfig),
                    productAnalytics: getProductAnalyticsStatus(),
                    wordAnalytics: getWordAnalyticsStatus(),
                },
                observability: getObservabilityStatus(),
                payments: {
                    schedulers: paymentSchedulers,
                    checkoutControl: paymentCheckoutControl ? {
                        available: paymentCheckoutControl.available,
                        paused: paymentCheckoutControl.control.paused,
                        rolloutPercent: paymentCheckoutControl.control.rolloutPercent,
                        revision: paymentCheckoutControl.control.revision,
                    } : null,
                },
                ...metrics,
            })
        );
    });

    const io = new Server(httpServer, {
        path: "/api/socketio",
        maxHttpBufferSize: 16 * 1024,
        cors: {
            origin(origin, callback) {
                const allowed = isTrustedWebOrigin({
                    origin,
                    isDev: dev,
                    trustedOrigins: trustedWebOrigins,
                    allowMissingOrigin: allowOriginlessSocketClients(dev),
                });
                callback(allowed ? null : new Error("Origin not allowed"), allowed);
            },
            methods: ["GET", "POST"],
        },
        transports: realtimeTopologyConfig.transports,
    });
    socketRedisAdapter = await configureSocketRedisAdapter(io);
    if (socketRedisAdapter.getStatus().enabled) {
        void reportWarning({
            service: "hushle-web",
            event: "realtime.redis_adapter.enabled",
            message: "Room state remains process-local; realtime replicas must not scale yet.",
        });
        if (!socketRedisAdapter.getStatus().stickySessionsConfigured) {
            void reportWarning({
                service: "hushle-web",
                event: "realtime.sticky_sessions.missing",
                message: "Socket.IO polling requires sticky sessions for multiple instances.",
            });
        }
    }
    roomOwnership = await createRoomOwnershipCoordinator({
        instanceId: getCapacityInstanceId(),
    });
    roomRouting = createRoomRouteResolver(roomOwnership);

    // Resolve auth when present, but keep guest socket access open.
    io.use(async (socket, nextMiddleware) => {
        const requestId = getOrCreateRequestId(
            typeof socket.request.headers["x-request-id"] === "string"
                ? socket.request.headers["x-request-id"]
                : undefined
        );
        socket.data.requestId = requestId;
        try {
            const token = process.env.AUTH_SECRET
                ? await getToken({
                    req: { headers: socket.request.headers } as never,
                    secret: process.env.AUTH_SECRET,
                    secureCookie: process.env.NODE_ENV === "production",
                })
                : null;

            socket.data.userId = token?.sub ?? null;
            nextMiddleware();
        } catch (error) {
            void reportError({
                service: "hushle-web",
                event: "socket.authentication.failed",
                requestId,
                error,
            });
            socket.data.userId = null;
            nextMiddleware();
        }
    });

    setupGameSocket(io, roomOwnership, roomRouting);
    const publishCurrentCapacity = () => {
        void publishCapacityHeartbeat(getLocalRoomCapacityMetrics()).catch(
            (error) => {
                void reportError({
                    service: "hushle-web",
                    event: "capacity.heartbeat.failed",
                    error,
                });
            }
        );
    };
    publishCurrentCapacity();
    const capacityHeartbeat = setInterval(publishCurrentCapacity, 10_000);
    capacityHeartbeat.unref();
    const ownershipHeartbeat = roomOwnership.getConfig().enabled
        ? setInterval(() => {
              void roomOwnership?.renewOwnedRooms().catch((error) => {
                  void reportError({
                      service: "hushle-web",
                      event: "room_ownership.heartbeat.failed",
                      error,
                  });
              });
          }, roomOwnership.getConfig().renewIntervalMs)
        : null;
    ownershipHeartbeat?.unref();

    httpServer.listen(port, hostname, () => {
        void emitObservabilityEvent({
            level: "info",
            service: "hushle-web",
            event: "runtime.started",
            context: {
                host: hostname,
                port,
                realtimeTopology: realtimeTopologyConfig.mode,
                realtimeReplicas: realtimeTopologyConfig.declaredReplicaCount,
                transports: realtimeTopologyConfig.transports,
            },
        });
    });

    let shuttingDown = false;
    const shutdown = async () => {
        if (shuttingDown) return;
        shuttingDown = true;
        void emitObservabilityEvent({
            level: "info",
            service: "hushle-web",
            event: "runtime.shutdown.requested",
        });
        clearInterval(capacityHeartbeat);
        if (ownershipHeartbeat) clearInterval(ownershipHeartbeat);
        await new Promise<void>((resolve) => {
            io.close(() => resolve());
        });
        await socketRedisAdapter?.close();
        await roomOwnership?.close();
        await removeCapacityHeartbeat();
        await flushObservabilityExporter();
        await closeRedisClient();
        if (!httpServer.listening) {
            process.exit(0);
            return;
        }
        httpServer.close(() => process.exit(0));
    };

    process.on("SIGTERM", shutdown);
    process.on("SIGINT", shutdown);
}).catch(async (error) => {
    await reportError({
        service: "hushle-web",
        event: "runtime.startup.failed",
        error,
    });
    await flushObservabilityExporter();
    process.exit(1);
});
