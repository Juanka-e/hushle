import {
    getRedisClient,
    getRedisKey,
    isRedisConfigured,
} from "@hushle/platform-cache";

interface LocalMembershipEntry {
    roomCode: string;
    timeout: ReturnType<typeof setTimeout>;
}

export interface ClaimRoomMembershipResult {
    allowed: boolean;
    currentRoomCode: string | null;
}

const ROOM_MEMBERSHIP_TTL_MS = Math.max(
    15_000,
    parseInt(process.env.ROOM_MEMBERSHIP_TTL_SECONDS || "45", 10) * 1000
);

const localMembershipByUser = new Map<number, LocalMembershipEntry>();

function getRoomMembershipKey(userId: number): string {
    return getRedisKey("room-membership", "user", userId);
}

function clearLocalMembershipTimeout(userId: number): void {
    const existing = localMembershipByUser.get(userId);
    if (existing) {
        clearTimeout(existing.timeout);
    }
}

function setLocalMembership(userId: number, roomCode: string): void {
    clearLocalMembershipTimeout(userId);
    const timeout = setTimeout(() => {
        localMembershipByUser.delete(userId);
    }, ROOM_MEMBERSHIP_TTL_MS);

    if (typeof timeout.unref === "function") {
        timeout.unref();
    }

    localMembershipByUser.set(userId, {
        roomCode,
        timeout,
    });
}

async function getDistributedMembership(userId: number): Promise<string | null> {
    if (!isRedisConfigured()) {
        return localMembershipByUser.get(userId)?.roomCode ?? null;
    }

    const client = await getRedisClient();
    if (!client) {
        return localMembershipByUser.get(userId)?.roomCode ?? null;
    }

    const roomCode = await client.get(getRoomMembershipKey(userId));
    return typeof roomCode === "string" && roomCode.length > 0 ? roomCode : null;
}

export async function getOnlineRoomMembership(userId: number): Promise<string | null> {
    return getDistributedMembership(userId);
}

export async function claimOnlineRoomMembership(
    userId: number,
    roomCode: string
): Promise<ClaimRoomMembershipResult> {
    if (!isRedisConfigured()) {
        const current = localMembershipByUser.get(userId)?.roomCode ?? null;
        if (current && current !== roomCode) {
            return {
                allowed: false,
                currentRoomCode: current,
            };
        }

        setLocalMembership(userId, roomCode);
        return {
            allowed: true,
            currentRoomCode: roomCode,
        };
    }

    const client = await getRedisClient();
    if (!client) {
        return claimOnlineRoomMembershipFallback(userId, roomCode);
    }

    const key = getRoomMembershipKey(userId);
    const current = await client.get(key);

    if (current && current !== roomCode) {
        return {
            allowed: false,
            currentRoomCode: current,
        };
    }

    if (current === roomCode) {
        await client.pExpire(key, ROOM_MEMBERSHIP_TTL_MS);
        return {
            allowed: true,
            currentRoomCode: roomCode,
        };
    }

    const created = await client.set(key, roomCode, {
        PX: ROOM_MEMBERSHIP_TTL_MS,
        NX: true,
    });

    if (created) {
        return {
            allowed: true,
            currentRoomCode: roomCode,
        };
    }

    const latest = await client.get(key);
    if (latest === roomCode) {
        await client.pExpire(key, ROOM_MEMBERSHIP_TTL_MS);
        return {
            allowed: true,
            currentRoomCode: roomCode,
        };
    }

    return {
        allowed: false,
        currentRoomCode: latest,
    };
}

function claimOnlineRoomMembershipFallback(
    userId: number,
    roomCode: string
): ClaimRoomMembershipResult {
    const current = localMembershipByUser.get(userId)?.roomCode ?? null;
    if (current && current !== roomCode) {
        return {
            allowed: false,
            currentRoomCode: current,
        };
    }

    setLocalMembership(userId, roomCode);
    return {
        allowed: true,
        currentRoomCode: roomCode,
    };
}

export async function refreshOnlineRoomMembership(
    userId: number,
    roomCode: string
): Promise<void> {
    if (!isRedisConfigured()) {
        const current = localMembershipByUser.get(userId)?.roomCode ?? null;
        if (current === roomCode) {
            setLocalMembership(userId, roomCode);
        }
        return;
    }

    const client = await getRedisClient();
    if (!client) {
        const current = localMembershipByUser.get(userId)?.roomCode ?? null;
        if (current === roomCode) {
            setLocalMembership(userId, roomCode);
        }
        return;
    }

    const key = getRoomMembershipKey(userId);
    const current = await client.get(key);
    if (current === roomCode) {
        await client.pExpire(key, ROOM_MEMBERSHIP_TTL_MS);
    }
}

export async function releaseOnlineRoomMembership(
    userId: number,
    roomCode: string
): Promise<void> {
    if (!isRedisConfigured()) {
        const current = localMembershipByUser.get(userId)?.roomCode ?? null;
        if (current === roomCode) {
            clearLocalMembershipTimeout(userId);
            localMembershipByUser.delete(userId);
        }
        return;
    }

    const client = await getRedisClient();
    if (!client) {
        const current = localMembershipByUser.get(userId)?.roomCode ?? null;
        if (current === roomCode) {
            clearLocalMembershipTimeout(userId);
            localMembershipByUser.delete(userId);
        }
        return;
    }

    const key = getRoomMembershipKey(userId);
    const current = await client.get(key);
    if (current === roomCode) {
        await client.del(key);
    }
}

export function resetRoomMembershipState(): void {
    for (const [userId, entry] of localMembershipByUser.entries()) {
        clearTimeout(entry.timeout);
        localMembershipByUser.delete(userId);
    }
}
