import {
    getRedisClient,
    getRedisKey,
    isRedisConfigured,
} from "@hushle/platform-cache";
import { randomUUID } from "node:crypto";

interface LockClaim {
    backend: "local" | "redis";
    key: string;
    token: string;
}

interface LocalLock {
    timeout: ReturnType<typeof setTimeout>;
    token: string;
}

const RELEASE_LOCK_SCRIPT = `
if redis.call("GET", KEYS[1]) == ARGV[1] then
    return redis.call("DEL", KEYS[1])
end
return 0
`;

const localLocks = new Map<string, LocalLock>();
const legacyClaims = new Map<string, LockClaim>();

function getRoomActionLockKey(roomCode: string, action: string): string {
    return getRedisKey("room-action-lock", roomCode, action);
}

function claimLocalLock(key: string, token: string, ttlMs: number): boolean {
    const existing = localLocks.get(key);
    if (existing) {
        return false;
    }

    const timeout = setTimeout(() => {
        if (localLocks.get(key)?.token === token) {
            localLocks.delete(key);
        }
    }, ttlMs);

    if (typeof timeout.unref === "function") {
        timeout.unref();
    }

    localLocks.set(key, { timeout, token });
    return true;
}

function releaseLocalLock(key: string, token: string): void {
    const lock = localLocks.get(key);
    if (!lock || lock.token !== token) {
        return;
    }

    clearTimeout(lock.timeout);
    localLocks.delete(key);
}

async function claimRoomActionLock(
    roomCode: string,
    action: string,
    ttlMs: number
): Promise<LockClaim | null> {
    const key = getRoomActionLockKey(roomCode, action);
    const token = randomUUID();

    if (!isRedisConfigured()) {
        return claimLocalLock(key, token, ttlMs)
            ? { backend: "local", key, token }
            : null;
    }

    const client = await getRedisClient();
    if (!client) {
        return claimLocalLock(key, token, ttlMs)
            ? { backend: "local", key, token }
            : null;
    }

    const acquired = await client.set(key, token, {
        PX: ttlMs,
        NX: true,
    });

    return acquired === "OK" ? { backend: "redis", key, token } : null;
}

async function releaseLockClaim(claim: LockClaim): Promise<void> {
    if (claim.backend === "local") {
        releaseLocalLock(claim.key, claim.token);
        return;
    }

    const client = await getRedisClient();
    if (!client) {
        return;
    }

    await client.eval(RELEASE_LOCK_SCRIPT, {
        keys: [claim.key],
        arguments: [claim.token],
    });
}

export async function acquireRoomActionLock(
    roomCode: string,
    action: string,
    ttlMs: number
): Promise<boolean> {
    const key = getRoomActionLockKey(roomCode, action);
    if (legacyClaims.has(key)) {
        return false;
    }

    const claim = await claimRoomActionLock(roomCode, action, ttlMs);
    if (!claim) {
        return false;
    }

    legacyClaims.set(key, claim);
    return true;
}

export async function releaseRoomActionLock(
    roomCode: string,
    action: string
): Promise<void> {
    const key = getRoomActionLockKey(roomCode, action);
    const claim = legacyClaims.get(key);
    if (!claim) {
        return;
    }

    legacyClaims.delete(key);
    await releaseLockClaim(claim);
}

export async function runWithRoomActionLock<T>(
    roomCode: string,
    action: string,
    ttlMs: number,
    operation: () => Promise<T>
): Promise<{ acquired: boolean; result?: T }> {
    const claim = await claimRoomActionLock(roomCode, action, ttlMs);
    if (!claim) {
        return { acquired: false };
    }

    try {
        return {
            acquired: true,
            result: await operation(),
        };
    } finally {
        await releaseLockClaim(claim);
    }
}

export function resetRoomActionLockState(): void {
    for (const [key, lock] of localLocks.entries()) {
        clearTimeout(lock.timeout);
        localLocks.delete(key);
    }
    legacyClaims.clear();
}
