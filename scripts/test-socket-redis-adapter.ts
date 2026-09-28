import assert from "node:assert/strict";
import { createServer, type Server as HttpServer } from "node:http";
import { io as createSocketClient, type Socket } from "socket.io-client";
import { Server } from "socket.io";
import {
    configureSocketRedisAdapter,
    getSocketRedisAdapterConfig,
    type SocketRedisAdapterHandle,
} from "../apps/web/src/lib/socket/socket-redis-adapter";

interface TestRuntime {
    httpServer: HttpServer;
    io: Server;
    adapter: SocketRedisAdapterHandle;
    port: number;
}

function withTimeout<T>(
    promise: Promise<T>,
    label: string,
    timeoutMs = 5_000
): Promise<T> {
    return new Promise<T>((resolve, reject) => {
        const timeout = setTimeout(
            () => reject(new Error(`${label} timed out after ${timeoutMs}ms`)),
            timeoutMs
        );
        promise.then(
            (value) => {
                clearTimeout(timeout);
                resolve(value);
            },
            (error) => {
                clearTimeout(timeout);
                reject(error);
            }
        );
    });
}

async function createRuntime(redisUrl: string): Promise<TestRuntime> {
    const httpServer = createServer();
    const io = new Server(httpServer, {
        transports: ["websocket"],
    });
    const adapter = await configureSocketRedisAdapter(io, {
        ...process.env,
        REDIS_URL: redisUrl,
        SOCKET_IO_REDIS_ADAPTER_ENABLED: "true",
        SOCKET_IO_STICKY_SESSIONS_CONFIGURED: "false",
    });
    io.on("connection", (socket) => {
        socket.on("join-test-room", async (ack: () => void) => {
            await socket.join("adapter-test-room");
            ack();
        });
    });
    await withTimeout(
        new Promise<void>((resolve) => {
            httpServer.listen(0, "127.0.0.1", resolve);
        }),
        "HTTP server listen"
    );
    const address = httpServer.address();
    assert.ok(address && typeof address !== "string");
    return { httpServer, io, adapter, port: address.port };
}

async function connectClient(port: number): Promise<Socket> {
    const socket = createSocketClient(`http://127.0.0.1:${port}`, {
        transports: ["websocket"],
        forceNew: true,
    });
    await withTimeout(
        new Promise<void>((resolve, reject) => {
            socket.once("connect", resolve);
            socket.once("connect_error", reject);
        }),
        "Socket.IO client connection"
    );
    await withTimeout(
        new Promise<void>((resolve) => {
            socket.emit("join-test-room", resolve);
        }),
        "Socket.IO room join"
    );
    return socket;
}

async function closeRuntime(runtime: TestRuntime): Promise<void> {
    await new Promise<void>((resolve) => {
        runtime.io.close(() => resolve());
    });
    await runtime.adapter.close();
    if (runtime.httpServer.listening) {
        await new Promise<void>((resolve, reject) => {
            runtime.httpServer.close((error) =>
                error ? reject(error) : resolve()
            );
        });
    }
}

async function run(): Promise<void> {
    assert.equal(
        process.env.SOCKET_REDIS_ADAPTER_TEST,
        "true",
        "SOCKET_REDIS_ADAPTER_TEST=true is required"
    );
    const redisUrl = process.env.REDIS_URL?.trim();
    assert.ok(redisUrl, "REDIS_URL is required");

    const disabledConfig = getSocketRedisAdapterConfig({});
    assert.equal(disabledConfig.enabled, false);
    assert.equal(disabledConfig.redisConfigured, false);
    const enabledConfig = getSocketRedisAdapterConfig({
        REDIS_URL: redisUrl,
        SOCKET_IO_REDIS_ADAPTER_ENABLED: "true",
        SOCKET_IO_STICKY_SESSIONS_CONFIGURED: "true",
    });
    assert.equal(enabledConfig.enabled, true);
    assert.equal(enabledConfig.redisConfigured, true);
    assert.equal(enabledConfig.stickySessionsConfigured, true);
    await assert.rejects(
        configureSocketRedisAdapter(new Server(), {
            SOCKET_IO_REDIS_ADAPTER_ENABLED: "true",
        }),
        /requires REDIS_URL/
    );

    const runtimes: TestRuntime[] = [];
    const clients: Socket[] = [];
    try {
        const firstRuntime = await createRuntime(redisUrl);
        runtimes.push(firstRuntime);
        const secondRuntime = await createRuntime(redisUrl);
        runtimes.push(secondRuntime);
        assert.equal(firstRuntime.adapter.getStatus().available, true);
        assert.equal(firstRuntime.adapter.getStatus().multiInstanceReady, false);

        const firstClient = await connectClient(firstRuntime.port);
        const secondClient = await connectClient(secondRuntime.port);
        clients.push(firstClient, secondClient);

        const crossInstanceEvent = new Promise<string>((resolve) => {
            secondClient.once("adapter-test-event", resolve);
        });
        firstRuntime.io
            .to("adapter-test-room")
            .emit("adapter-test-event", "cross-instance-ok");
        assert.equal(
            await withTimeout(
                crossInstanceEvent,
                "Cross-instance Redis adapter event"
            ),
            "cross-instance-ok"
        );

        console.log("Socket.IO Redis adapter integration test passed");
    } finally {
        for (const client of clients) {
            client.disconnect();
        }
        for (const runtime of runtimes.reverse()) {
            await closeRuntime(runtime);
        }
    }
}

void run();
