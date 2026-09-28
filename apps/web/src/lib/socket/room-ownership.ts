import { randomUUID } from "node:crypto";
import {
    getRedisClient,
    getRedisKey,
    isRedisConfigured,
    type RedisLikeClient,
} from "@hushle/platform-cache";

const RENEW_LEASE_SCRIPT = `
if redis.call("GET", KEYS[1]) == ARGV[1] then
  return redis.call("PEXPIRE", KEYS[1], ARGV[2])
end
return 0
`;

const RELEASE_LEASE_SCRIPT = `
if redis.call("GET", KEYS[1]) == ARGV[1] then
  return redis.call("DEL", KEYS[1])
end
return 0
`;

const DEFAULT_LEASE_TTL_MS = 30_000;
const DEFAULT_RENEW_INTERVAL_MS = 10_000;

export interface RoomOwnershipEnvironment {
    ROOM_OWNERSHIP_LEASE_ENABLED?: string;
    ROOM_OWNERSHIP_LEASE_TTL_MS?: string;
    ROOM_OWNERSHIP_RENEW_INTERVAL_MS?: string;
}

export interface RoomOwnershipConfig {
    enabled: boolean;
    leaseTtlMs: number;
    renewIntervalMs: number;
}

export interface RoomOwnershipClaim {
    acquired: boolean;
    ownerInstanceId: string | null;
}

export interface RoomOwnershipStatus {
    enabled: boolean;
    available: boolean;
    instanceId: string;
    leaseTtlMs: number;
    renewIntervalMs: number;
    trackedRooms: number;
    ownedRooms: number;
    lostRooms: number;
    claimConflicts: number;
    lostOwnerships: number;
    renewFailures: number;
    lastRenewedAt: string | null;
    enforcement: "create-only";
}

export interface RoomOwnershipCoordinator {
    getConfig(): RoomOwnershipConfig;
    getStatus(): RoomOwnershipStatus;
    claim(roomCode: string): Promise<RoomOwnershipClaim>;
    getOwner(roomCode: string): Promise<string | null>;
    renewOwnedRooms(): Promise<void>;
    release(roomCode: string): Promise<void>;
    close(): Promise<void>;
}

interface StoredRoomLease {
    instanceId: string;
    token: string;
    claimedAt: string;
}

interface LocalRoomLease {
    serialized: string;
    state: "owned" | "lost";
}

function readBoolean(value: string | undefined): boolean {
    return value?.trim().toLowerCase() === "true";
}

function parseIntegerSetting(options: {
    name: string;
    value: string | undefined;
    fallback: number;
    min: number;
    max: number;
}): number {
    if (options.value === undefined || options.value.trim() === "") {
        return options.fallback;
    }

    const parsed = Number(options.value);
    if (
        !Number.isSafeInteger(parsed) ||
        parsed < options.min ||
        parsed > options.max
    ) {
        throw new Error(
            `${options.name} must be between ${options.min} and ${options.max}`
        );
    }
    return parsed;
}

export function getRoomOwnershipConfig(
    env?: RoomOwnershipEnvironment
): RoomOwnershipConfig {
    const runtimeEnv = env ?? {
        ROOM_OWNERSHIP_LEASE_ENABLED:
            process.env.ROOM_OWNERSHIP_LEASE_ENABLED,
        ROOM_OWNERSHIP_LEASE_TTL_MS:
            process.env.ROOM_OWNERSHIP_LEASE_TTL_MS,
        ROOM_OWNERSHIP_RENEW_INTERVAL_MS:
            process.env.ROOM_OWNERSHIP_RENEW_INTERVAL_MS,
    };
    const leaseTtlMs = parseIntegerSetting({
        name: "ROOM_OWNERSHIP_LEASE_TTL_MS",
        value: runtimeEnv.ROOM_OWNERSHIP_LEASE_TTL_MS,
        fallback: DEFAULT_LEASE_TTL_MS,
        min: 10_000,
        max: 300_000,
    });
    const renewIntervalMs = parseIntegerSetting({
        name: "ROOM_OWNERSHIP_RENEW_INTERVAL_MS",
        value: runtimeEnv.ROOM_OWNERSHIP_RENEW_INTERVAL_MS,
        fallback: DEFAULT_RENEW_INTERVAL_MS,
        min: 1_000,
        max: 120_000,
    });
    if (renewIntervalMs * 2 >= leaseTtlMs) {
        throw new Error(
            "ROOM_OWNERSHIP_RENEW_INTERVAL_MS must be less than half of ROOM_OWNERSHIP_LEASE_TTL_MS"
        );
    }

    return {
        enabled: readBoolean(runtimeEnv.ROOM_OWNERSHIP_LEASE_ENABLED),
        leaseTtlMs,
        renewIntervalMs,
    };
}

function getRoomOwnershipKey(roomCode: string): string {
    return getRedisKey("room-ownership", roomCode.trim().toUpperCase());
}

function parseStoredLease(raw: string | null): StoredRoomLease | null {
    if (!raw) return null;
    try {
        const parsed = JSON.parse(raw) as Partial<StoredRoomLease>;
        if (
            typeof parsed.instanceId !== "string" ||
            typeof parsed.token !== "string" ||
            typeof parsed.claimedAt !== "string"
        ) {
            return null;
        }
        return parsed as StoredRoomLease;
    } catch {
        return null;
    }
}

export async function createRoomOwnershipCoordinator(options: {
    instanceId: string;
    env?: RoomOwnershipEnvironment;
}): Promise<RoomOwnershipCoordinator> {
    const instanceId = options.instanceId.trim();
    if (!instanceId) {
        throw new Error("Room ownership requires a non-empty instance id");
    }

    const config = getRoomOwnershipConfig(options.env);
    let client: RedisLikeClient | null = null;
    if (config.enabled) {
        if (!isRedisConfigured()) {
            throw new Error(
                "ROOM_OWNERSHIP_LEASE_ENABLED=true requires REDIS_URL"
            );
        }
        client = await getRedisClient();
        if (!client) {
            throw new Error(
                "Redis is unavailable; refusing uncoordinated room ownership"
            );
        }
    }

    const leases = new Map<string, LocalRoomLease>();
    let available = config.enabled && client !== null;
    let claimConflicts = 0;
    let lostOwnerships = 0;
    let renewFailures = 0;
    let lastRenewedAt: string | null = null;
    let closed = false;
    let activeRenewal: Promise<void> | null = null;

    function requireClient(): RedisLikeClient {
        if (closed) {
            throw new Error("Room ownership coordinator is closed");
        }
        if (!client) {
            throw new Error("Room ownership Redis client is unavailable");
        }
        return client;
    }

    function markLost(entry: LocalRoomLease): void {
        if (entry.state !== "lost") {
            entry.state = "lost";
            lostOwnerships += 1;
        }
    }

    async function renewEntry(
        redis: RedisLikeClient,
        roomCode: string,
        entry: LocalRoomLease
    ): Promise<void> {
        if (entry.state === "lost") {
            return;
        }

        const key = getRoomOwnershipKey(roomCode);
        const renewed = Number(
            await redis.eval(RENEW_LEASE_SCRIPT, {
                keys: [key],
                arguments: [entry.serialized, String(config.leaseTtlMs)],
            })
        );
        if (renewed === 1) {
            entry.state = "owned";
            return;
        }

        const current = await redis.get(key);
        if (current === null) {
            const reclaimed = await redis.set(key, entry.serialized, {
                PX: config.leaseTtlMs,
                NX: true,
            });
            if (reclaimed === "OK") {
                entry.state = "owned";
                return;
            }
        }
        markLost(entry);
    }

    async function releaseLease(roomCode: string): Promise<void> {
        const normalizedRoomCode = roomCode.trim().toUpperCase();
        const entry = leases.get(normalizedRoomCode);
        leases.delete(normalizedRoomCode);
        if (!config.enabled || !entry || !client) {
            return;
        }

        try {
            await client.eval(RELEASE_LEASE_SCRIPT, {
                keys: [getRoomOwnershipKey(normalizedRoomCode)],
                arguments: [entry.serialized],
            });
            available = true;
        } catch (error) {
            available = false;
            throw error;
        }
    }

    return {
        getConfig: () => ({ ...config }),
        getStatus: () => {
            let ownedRooms = 0;
            let lostRooms = 0;
            for (const entry of leases.values()) {
                if (entry.state === "owned") ownedRooms += 1;
                else lostRooms += 1;
            }
            return {
                enabled: config.enabled,
                available,
                instanceId,
                leaseTtlMs: config.leaseTtlMs,
                renewIntervalMs: config.renewIntervalMs,
                trackedRooms: leases.size,
                ownedRooms,
                lostRooms,
                claimConflicts,
                lostOwnerships,
                renewFailures,
                lastRenewedAt,
                enforcement: "create-only",
            };
        },
        async claim(roomCode) {
            if (closed) {
                throw new Error("Room ownership coordinator is closed");
            }
            if (!config.enabled) {
                return { acquired: true, ownerInstanceId: instanceId };
            }

            const normalizedRoomCode = roomCode.trim().toUpperCase();
            const redis = requireClient();
            const existingLocal = leases.get(normalizedRoomCode);
            if (existingLocal?.state === "owned") {
                return { acquired: true, ownerInstanceId: instanceId };
            }
            if (existingLocal?.state === "lost") {
                const current = parseStoredLease(
                    await redis.get(getRoomOwnershipKey(normalizedRoomCode))
                );
                return {
                    acquired: false,
                    ownerInstanceId: current?.instanceId ?? null,
                };
            }

            const lease: StoredRoomLease = {
                instanceId,
                token: randomUUID(),
                claimedAt: new Date().toISOString(),
            };
            const serialized = JSON.stringify(lease);
            try {
                const acquired = await redis.set(
                    getRoomOwnershipKey(normalizedRoomCode),
                    serialized,
                    { PX: config.leaseTtlMs, NX: true }
                );
                available = true;
                if (acquired === "OK") {
                    leases.set(normalizedRoomCode, {
                        serialized,
                        state: "owned",
                    });
                    return { acquired: true, ownerInstanceId: instanceId };
                }

                claimConflicts += 1;
                const current = parseStoredLease(
                    await redis.get(getRoomOwnershipKey(normalizedRoomCode))
                );
                return {
                    acquired: false,
                    ownerInstanceId: current?.instanceId ?? null,
                };
            } catch (error) {
                available = false;
                throw error;
            }
        },
        async getOwner(roomCode) {
            if (!config.enabled) {
                return leases.has(roomCode.trim().toUpperCase())
                    ? instanceId
                    : null;
            }
            try {
                const current = parseStoredLease(
                    await requireClient().get(getRoomOwnershipKey(roomCode))
                );
                available = true;
                return current?.instanceId ?? null;
            } catch (error) {
                available = false;
                throw error;
            }
        },
        async renewOwnedRooms() {
            if (!config.enabled || leases.size === 0 || closed) {
                return;
            }
            if (activeRenewal) {
                return activeRenewal;
            }

            activeRenewal = (async () => {
                try {
                    const redis = requireClient();
                    await Promise.all(
                        [...leases.entries()].map(([roomCode, entry]) =>
                            renewEntry(redis, roomCode, entry)
                        )
                    );
                    available = true;
                    lastRenewedAt = new Date().toISOString();
                } catch (error) {
                    available = false;
                    renewFailures += 1;
                    throw error;
                } finally {
                    activeRenewal = null;
                }
            })();
            return activeRenewal;
        },
        release: releaseLease,
        async close() {
            if (closed) return;
            if (activeRenewal) {
                await activeRenewal.catch(() => undefined);
            }
            const roomCodes = [...leases.keys()];
            await Promise.allSettled(
                roomCodes.map((roomCode) => releaseLease(roomCode))
            );
            closed = true;
            available = false;
        },
    };
}
