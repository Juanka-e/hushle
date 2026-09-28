import {
    getRedisClient,
    getRedisKey,
    isRedisConfigured,
} from "@hushle/platform-cache";

interface LocalAdminHandoffEntry {
    adminPlayerId: string;
    deadlineAt: number;
    timeout: ReturnType<typeof setTimeout>;
}

export interface PendingRoomAdminHandoff {
    roomCode: string;
    adminPlayerId: string;
    deadlineAt: number;
}

const localAdminHandoffs = new Map<string, LocalAdminHandoffEntry>();

function getRoomAdminHandoffKey(roomCode: string): string {
    return getRedisKey("room-admin-handoff", roomCode);
}

function clearLocalAdminHandoffTimeout(roomCode: string): void {
    const existing = localAdminHandoffs.get(roomCode);
    if (existing) {
        clearTimeout(existing.timeout);
    }
}

function setLocalAdminHandoff(
    roomCode: string,
    adminPlayerId: string,
    ttlMs: number
): PendingRoomAdminHandoff {
    clearLocalAdminHandoffTimeout(roomCode);
    const deadlineAt = Date.now() + ttlMs;
    const timeout = setTimeout(() => {
        localAdminHandoffs.delete(roomCode);
    }, ttlMs);

    if (typeof timeout.unref === "function") {
        timeout.unref();
    }

    localAdminHandoffs.set(roomCode, {
        adminPlayerId,
        deadlineAt,
        timeout,
    });

    return {
        roomCode,
        adminPlayerId,
        deadlineAt,
    };
}

export async function setPendingRoomAdminHandoff(
    roomCode: string,
    adminPlayerId: string,
    ttlMs: number
): Promise<PendingRoomAdminHandoff> {
    if (!isRedisConfigured()) {
        return setLocalAdminHandoff(roomCode, adminPlayerId, ttlMs);
    }

    const client = await getRedisClient();
    if (!client) {
        return setLocalAdminHandoff(roomCode, adminPlayerId, ttlMs);
    }

    const payload: PendingRoomAdminHandoff = {
        roomCode,
        adminPlayerId,
        deadlineAt: Date.now() + ttlMs,
    };

    await client.set(getRoomAdminHandoffKey(roomCode), JSON.stringify(payload), {
        PX: ttlMs,
    });

    return payload;
}

export async function getPendingRoomAdminHandoff(
    roomCode: string
): Promise<PendingRoomAdminHandoff | null> {
    if (!isRedisConfigured()) {
        const current = localAdminHandoffs.get(roomCode);
        if (!current) {
            return null;
        }

        return {
            roomCode,
            adminPlayerId: current.adminPlayerId,
            deadlineAt: current.deadlineAt,
        };
    }

    const client = await getRedisClient();
    if (!client) {
        const current = localAdminHandoffs.get(roomCode);
        if (!current) {
            return null;
        }

        return {
            roomCode,
            adminPlayerId: current.adminPlayerId,
            deadlineAt: current.deadlineAt,
        };
    }

    const raw = await client.get(getRoomAdminHandoffKey(roomCode));
    if (!raw) {
        return null;
    }

    try {
        const parsed = JSON.parse(raw) as PendingRoomAdminHandoff;
        if (
            typeof parsed.roomCode !== "string" ||
            typeof parsed.adminPlayerId !== "string" ||
            typeof parsed.deadlineAt !== "number"
        ) {
            return null;
        }

        return parsed;
    } catch {
        return null;
    }
}

export async function clearPendingRoomAdminHandoff(
    roomCode: string,
    expectedAdminPlayerId?: string
): Promise<void> {
    if (!isRedisConfigured()) {
        const current = localAdminHandoffs.get(roomCode);
        if (!current) {
            return;
        }

        if (
            typeof expectedAdminPlayerId === "string" &&
            current.adminPlayerId !== expectedAdminPlayerId
        ) {
            return;
        }

        clearLocalAdminHandoffTimeout(roomCode);
        localAdminHandoffs.delete(roomCode);
        return;
    }

    const client = await getRedisClient();
    if (!client) {
        const current = localAdminHandoffs.get(roomCode);
        if (!current) {
            return;
        }

        if (
            typeof expectedAdminPlayerId === "string" &&
            current.adminPlayerId !== expectedAdminPlayerId
        ) {
            return;
        }

        clearLocalAdminHandoffTimeout(roomCode);
        localAdminHandoffs.delete(roomCode);
        return;
    }

    if (typeof expectedAdminPlayerId === "string") {
        const current = await getPendingRoomAdminHandoff(roomCode);
        if (!current || current.adminPlayerId !== expectedAdminPlayerId) {
            return;
        }
    }

    await client.del(getRoomAdminHandoffKey(roomCode));
}

export function resetRoomAdminHandoffState(): void {
    for (const [roomCode, entry] of localAdminHandoffs.entries()) {
        clearTimeout(entry.timeout);
        localAdminHandoffs.delete(roomCode);
    }
}
