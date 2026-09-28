import { hostname } from "node:os";
import { monitorEventLoopDelay } from "node:perf_hooks";
import {
    getRedisClient,
    getRedisKey,
    isRedisConfigured,
} from "@hushle/platform-cache";

const CAPACITY_HEARTBEAT_TTL_MS = 30_000;
const CAPACITY_INSTANCE_ID =
    process.env.INSTANCE_ID?.trim() || `${hostname()}:${process.pid}`;
const eventLoopDelay = monitorEventLoopDelay({ resolution: 20 });

eventLoopDelay.enable();

export interface LocalRoomCapacityMetrics {
    activeRooms: number;
    activeMatches: number;
    onlinePlayers: number;
    spectators: number;
    connectedSockets: number;
}

export interface CapacityInstanceSnapshot extends LocalRoomCapacityMetrics {
    instanceId: string;
    updatedAt: string;
    rssBytes: number;
    heapUsedBytes: number;
    eventLoopLagMs: number;
}

export interface CapacityClusterSnapshot {
    source: "redis" | "local";
    activeInstances: number;
    activeRooms: number;
    activeMatches: number;
    onlinePlayers: number;
    spectators: number;
    connectedSockets: number;
    rssBytes: number;
    heapUsedBytes: number;
    maxEventLoopLagMs: number;
    instances: CapacityInstanceSnapshot[];
}

let latestLocalMetrics: LocalRoomCapacityMetrics = {
    activeRooms: 0,
    activeMatches: 0,
    onlinePlayers: 0,
    spectators: 0,
    connectedSockets: 0,
};

function registryKey(): string {
    return getRedisKey("capacity", "instances");
}

function instanceKey(instanceId: string): string {
    return getRedisKey("capacity", "instance", instanceId);
}

function buildInstanceSnapshot(
    metrics: LocalRoomCapacityMetrics
): CapacityInstanceSnapshot {
    const memory = process.memoryUsage();
    const eventLoopLagMs = Number.isFinite(eventLoopDelay.mean)
        ? Math.round((eventLoopDelay.mean / 1_000_000) * 100) / 100
        : 0;
    eventLoopDelay.reset();

    return {
        instanceId: CAPACITY_INSTANCE_ID,
        updatedAt: new Date().toISOString(),
        ...metrics,
        rssBytes: memory.rss,
        heapUsedBytes: memory.heapUsed,
        eventLoopLagMs,
    };
}

function parseInstanceSnapshot(raw: string): CapacityInstanceSnapshot | null {
    try {
        const parsed = JSON.parse(raw) as Partial<CapacityInstanceSnapshot>;
        if (
            typeof parsed.instanceId !== "string" ||
            typeof parsed.updatedAt !== "string" ||
            typeof parsed.activeRooms !== "number" ||
            typeof parsed.activeMatches !== "number" ||
            typeof parsed.onlinePlayers !== "number" ||
            typeof parsed.spectators !== "number" ||
            typeof parsed.connectedSockets !== "number" ||
            typeof parsed.rssBytes !== "number" ||
            typeof parsed.heapUsedBytes !== "number" ||
            typeof parsed.eventLoopLagMs !== "number"
        ) {
            return null;
        }

        return parsed as CapacityInstanceSnapshot;
    } catch {
        return null;
    }
}

function aggregateInstances(
    instances: CapacityInstanceSnapshot[],
    source: "redis" | "local"
): CapacityClusterSnapshot {
    return {
        source,
        activeInstances: instances.length,
        activeRooms: instances.reduce(
            (total, instance) => total + instance.activeRooms,
            0
        ),
        activeMatches: instances.reduce(
            (total, instance) => total + instance.activeMatches,
            0
        ),
        onlinePlayers: instances.reduce(
            (total, instance) => total + instance.onlinePlayers,
            0
        ),
        spectators: instances.reduce(
            (total, instance) => total + instance.spectators,
            0
        ),
        connectedSockets: instances.reduce(
            (total, instance) => total + instance.connectedSockets,
            0
        ),
        rssBytes: instances.reduce(
            (total, instance) => total + instance.rssBytes,
            0
        ),
        heapUsedBytes: instances.reduce(
            (total, instance) => total + instance.heapUsedBytes,
            0
        ),
        maxEventLoopLagMs: instances.reduce(
            (maximum, instance) =>
                Math.max(maximum, instance.eventLoopLagMs),
            0
        ),
        instances,
    };
}

export async function publishCapacityHeartbeat(
    metrics: LocalRoomCapacityMetrics
): Promise<void> {
    latestLocalMetrics = { ...metrics };

    if (!isRedisConfigured()) {
        return;
    }

    try {
        const client = await getRedisClient();
        if (!client || !client.sAdd) {
            return;
        }

        const snapshot = buildInstanceSnapshot(metrics);
        await Promise.all([
            client.sAdd(registryKey(), CAPACITY_INSTANCE_ID),
            client.set(
                instanceKey(CAPACITY_INSTANCE_ID),
                JSON.stringify(snapshot),
                { PX: CAPACITY_HEARTBEAT_TTL_MS }
            ),
        ]);
    } catch (error) {
        console.error("Capacity heartbeat Redis write failed", error);
    }
}

export async function removeCapacityHeartbeat(): Promise<void> {
    if (!isRedisConfigured()) {
        return;
    }

    try {
        const client = await getRedisClient();
        if (!client) {
            return;
        }

        await Promise.all([
            client.del(instanceKey(CAPACITY_INSTANCE_ID)),
            client.sRem?.(registryKey(), CAPACITY_INSTANCE_ID) ??
                Promise.resolve(0),
        ]);
    } catch (error) {
        console.error("Capacity heartbeat cleanup failed", error);
    }
}

export async function getCapacityClusterSnapshot(
    localMetrics: LocalRoomCapacityMetrics = latestLocalMetrics
): Promise<CapacityClusterSnapshot> {
    const localInstance = buildInstanceSnapshot(localMetrics);

    if (!isRedisConfigured()) {
        return aggregateInstances([localInstance], "local");
    }

    try {
        const client = await getRedisClient();
        if (!client?.sMembers) {
            return aggregateInstances([localInstance], "local");
        }

        const instanceIds = await client.sMembers(registryKey());
        const keys = instanceIds.map(instanceKey);
        const rawSnapshots =
            keys.length === 0
                ? []
                : client.mGet
                  ? await client.mGet(keys)
                  : await Promise.all(keys.map((key) => client.get(key)));
        const instances: CapacityInstanceSnapshot[] = [];
        const staleIds: string[] = [];

        instanceIds.forEach((instanceId, index) => {
            const raw = rawSnapshots[index];
            const parsed = raw ? parseInstanceSnapshot(raw) : null;
            if (!parsed) {
                staleIds.push(instanceId);
                return;
            }

            // The current process has fresher metrics than its last heartbeat.
            instances.push(
                instanceId === CAPACITY_INSTANCE_ID ? localInstance : parsed
            );
        });

        if (client.sRem) {
            await Promise.all(
                staleIds.map((instanceId) =>
                    client.sRem!(registryKey(), instanceId)
                )
            );
        }

        if (!instanceIds.includes(CAPACITY_INSTANCE_ID)) {
            instances.push(localInstance);
        }

        return aggregateInstances(instances, "redis");
    } catch (error) {
        console.error("Capacity snapshot Redis read failed", error);
        return aggregateInstances([localInstance], "local");
    }
}

export function getCapacityInstanceId(): string {
    return CAPACITY_INSTANCE_ID;
}
