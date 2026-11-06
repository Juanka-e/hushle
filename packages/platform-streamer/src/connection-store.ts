import { prisma, StreamerConnectionStatus, StreamerPlatform as PrismaStreamerPlatform } from "@hushle/platform-db";
import type { PlatformIdentity, StreamerPlatform } from "./platform-client";

// The persistence seam for streamer connections. Prisma behind it in the app and the jobs
// runner; an in-memory twin for tests of the token service, the connect flow and the hygiene job.

export type StreamerConnectionStatusValue = "active" | "needs_reconnect" | "revoked";
export type StatusReason = "refresh_failed" | "dormant" | "user_disconnected" | "account_closed" | "scope_change";

export interface StreamerConnectionRecord {
    id: string;
    userId: number;
    platform: StreamerPlatform;
    platformUserId: string;
    login: string;
    displayName: string;
    avatarUrl: string | null;
    channelUrl: string;
    scopes: string;
    accessTokenEnc: string | null;
    refreshTokenEnc: string | null;
    tokenKeyVersion: number | null;
    accessTokenExpiresAt: Date | null;
    status: StreamerConnectionStatusValue;
    statusReason: string | null;
    lastValidatedAt: Date | null;
    lastUsedAt: Date | null;
    connectedAt: Date;
    revokedAt: Date | null;
    createdAt: Date;
    updatedAt: Date;
}

export interface UpsertLinkedInput {
    userId: number;
    platform: StreamerPlatform;
    identity: PlatformIdentity;
    scopes: string[];
    accessTokenEnc: string;
    refreshTokenEnc: string | null;
    tokenKeyVersion: number;
    accessTokenExpiresAt: Date | null;
    now: Date;
}

export interface UpdateTokensInput {
    accessTokenEnc: string;
    refreshTokenEnc: string | null;
    tokenKeyVersion: number;
    accessTokenExpiresAt: Date | null;
    now: Date;
    /**
     * The refresh-token ciphertext the row held when this refresh started. The write is a
     * compare-and-set: it lands only while the row still holds exactly this value.
     */
    previousRefreshTokenEnc: string | null;
}

export interface StreamerConnectionStore {
    findByUser(userId: number): Promise<StreamerConnectionRecord[]>;
    findByUserAndPlatform(userId: number, platform: StreamerPlatform): Promise<StreamerConnectionRecord | null>;
    findByPlatformUser(platform: StreamerPlatform, platformUserId: string): Promise<StreamerConnectionRecord | null>;
    upsertLinked(input: UpsertLinkedInput): Promise<{ record: StreamerConnectionRecord; relinked: boolean }>;
    /**
     * Writes only while the row is still `active` and still holds `previousRefreshTokenEnc`; null
     * means another write got there first (a concurrent refresh, a relink, a disconnect).
     */
    updateTokens(id: string, input: UpdateTokensInput): Promise<StreamerConnectionRecord | null>;
    /**
     * No-op on a `revoked` row: a late failure never downgrades an explicit disconnect. With
     * `expectedRefreshTokenEnc` it marks only while the row still holds exactly that refresh-token
     * ciphertext (null included), so a relink that landed meanwhile is never wiped. Null: not marked.
     */
    markNeedsReconnect(id: string, reason: StatusReason, now: Date, expectedRefreshTokenEnc?: string | null): Promise<StreamerConnectionRecord | null>;
    markRevoked(id: string, reason: StatusReason, now: Date): Promise<StreamerConnectionRecord>;
    deleteById(id: string): Promise<void>;
    touchUsed(id: string, now: Date): Promise<void>;
    touchValidated(id: string, now: Date): Promise<void>;
    findDormant(cutoff: Date, limit: number): Promise<StreamerConnectionRecord[]>;
}

const MAX_SCOPES_LENGTH = 255;

function joinScopes(scopes: string[]): string {
    return scopes.join(" ").slice(0, MAX_SCOPES_LENGTH);
}

function identityColumns(identity: PlatformIdentity) {
    return {
        platformUserId: identity.platformUserId.slice(0, 64),
        login: identity.login.slice(0, 64),
        displayName: identity.displayName.slice(0, 100),
        avatarUrl: identity.avatarUrl ? identity.avatarUrl.slice(0, 500) : null,
        channelUrl: identity.channelUrl.slice(0, 255),
    };
}

// ---------------------------------------------------------------- Prisma

export const prismaStreamerConnectionStore: StreamerConnectionStore = {
    findByUser(userId) {
        return prisma.streamerConnection.findMany({ where: { userId }, orderBy: { platform: "asc" } });
    },
    findByUserAndPlatform(userId, platform) {
        return prisma.streamerConnection.findUnique({ where: { userId_platform: { userId, platform } } });
    },
    findByPlatformUser(platform, platformUserId) {
        return prisma.streamerConnection.findUnique({ where: { platform_platformUserId: { platform, platformUserId } } });
    },
    async upsertLinked(input) {
        const columns = {
            ...identityColumns(input.identity),
            scopes: joinScopes(input.scopes),
            accessTokenEnc: input.accessTokenEnc,
            refreshTokenEnc: input.refreshTokenEnc,
            tokenKeyVersion: input.tokenKeyVersion,
            accessTokenExpiresAt: input.accessTokenExpiresAt,
            status: StreamerConnectionStatus.active,
            statusReason: null,
            revokedAt: null,
            connectedAt: input.now,
            lastValidatedAt: input.now,
            lastUsedAt: null,
        };
        const existing = await prisma.streamerConnection.findUnique({
            where: { userId_platform: { userId: input.userId, platform: input.platform } },
            select: { id: true },
        });
        if (existing) {
            const record = await prisma.streamerConnection.update({ where: { id: existing.id }, data: columns });
            return { record, relinked: true };
        }
        const record = await prisma.streamerConnection.create({
            data: { userId: input.userId, platform: input.platform as PrismaStreamerPlatform, ...columns },
        });
        return { record, relinked: false };
    },
    async updateTokens(id, input) {
        const result = await prisma.streamerConnection.updateMany({
            where: { id, status: StreamerConnectionStatus.active, refreshTokenEnc: input.previousRefreshTokenEnc },
            data: {
                accessTokenEnc: input.accessTokenEnc,
                refreshTokenEnc: input.refreshTokenEnc,
                tokenKeyVersion: input.tokenKeyVersion,
                accessTokenExpiresAt: input.accessTokenExpiresAt,
                lastValidatedAt: input.now,
            },
        });
        if (result.count === 0) return null;
        return prisma.streamerConnection.findUnique({ where: { id } });
    },
    async markNeedsReconnect(id, reason, now, expectedRefreshTokenEnc) {
        const result = await prisma.streamerConnection.updateMany({
            where: {
                id,
                status: { not: StreamerConnectionStatus.revoked },
                ...(expectedRefreshTokenEnc === undefined ? {} : { refreshTokenEnc: expectedRefreshTokenEnc }),
            },
            data: { status: StreamerConnectionStatus.needs_reconnect, statusReason: reason, accessTokenEnc: null, refreshTokenEnc: null, tokenKeyVersion: null, accessTokenExpiresAt: null, revokedAt: now },
        });
        if (result.count === 0) return null;
        return prisma.streamerConnection.findUnique({ where: { id } });
    },
    async deleteById(id) {
        await prisma.streamerConnection.deleteMany({ where: { id } });
    },
    markRevoked(id, reason, now) {
        return prisma.streamerConnection.update({
            where: { id },
            data: { status: StreamerConnectionStatus.revoked, statusReason: reason, accessTokenEnc: null, refreshTokenEnc: null, tokenKeyVersion: null, accessTokenExpiresAt: null, revokedAt: now },
        });
    },
    async touchUsed(id, now) {
        await prisma.streamerConnection.update({ where: { id }, data: { lastUsedAt: now } });
    },
    async touchValidated(id, now) {
        await prisma.streamerConnection.update({ where: { id }, data: { lastValidatedAt: now } });
    },
    findDormant(cutoff, limit) {
        return prisma.streamerConnection.findMany({
            where: {
                status: StreamerConnectionStatus.active,
                OR: [{ lastUsedAt: { lt: cutoff } }, { lastUsedAt: null, connectedAt: { lt: cutoff } }],
            },
            orderBy: [{ lastUsedAt: "asc" }, { connectedAt: "asc" }],
            take: limit,
        });
    },
};

// ---------------------------------------------------------------- memory (tests)

export interface MemoryStreamerConnectionStore extends StreamerConnectionStore {
    readonly rows: StreamerConnectionRecord[];
    seed(record: StreamerConnectionRecord): StreamerConnectionRecord;
}

export function createMemoryStreamerConnectionStore(): MemoryStreamerConnectionStore {
    const rows: StreamerConnectionRecord[] = [];
    let sequence = 0;
    const clone = (record: StreamerConnectionRecord): StreamerConnectionRecord => ({ ...record });
    const byId = (id: string): StreamerConnectionRecord => {
        const record = rows.find((row) => row.id === id);
        if (!record) throw new Error("streamer connection not found");
        return record;
    };
    const clear = (record: StreamerConnectionRecord, status: StreamerConnectionStatusValue, reason: StatusReason, now: Date) => {
        Object.assign(record, { status, statusReason: reason, accessTokenEnc: null, refreshTokenEnc: null, tokenKeyVersion: null, accessTokenExpiresAt: null, revokedAt: now, updatedAt: now });
        return clone(record);
    };

    return {
        rows,
        seed(record) {
            rows.push({ ...record });
            return clone(record);
        },
        async findByUser(userId) {
            return rows.filter((row) => row.userId === userId).map(clone);
        },
        async findByUserAndPlatform(userId, platform) {
            const record = rows.find((row) => row.userId === userId && row.platform === platform);
            return record ? clone(record) : null;
        },
        async findByPlatformUser(platform, platformUserId) {
            const record = rows.find((row) => row.platform === platform && row.platformUserId === platformUserId);
            return record ? clone(record) : null;
        },
        async upsertLinked(input) {
            const columns = {
                ...identityColumns(input.identity),
                scopes: joinScopes(input.scopes),
                accessTokenEnc: input.accessTokenEnc,
                refreshTokenEnc: input.refreshTokenEnc,
                tokenKeyVersion: input.tokenKeyVersion,
                accessTokenExpiresAt: input.accessTokenExpiresAt,
                status: "active" as const,
                statusReason: null,
                revokedAt: null,
                connectedAt: input.now,
                lastValidatedAt: input.now,
                lastUsedAt: null,
                updatedAt: input.now,
            };
            const existing = rows.find((row) => row.userId === input.userId && row.platform === input.platform);
            if (existing) {
                Object.assign(existing, columns);
                return { record: clone(existing), relinked: true };
            }
            const taken = rows.find((row) => row.platform === input.platform && row.platformUserId === input.identity.platformUserId);
            if (taken) {
                const error = new Error("Unique constraint failed") as Error & { code: string };
                error.code = "P2002";
                throw error;
            }
            sequence += 1;
            const record: StreamerConnectionRecord = {
                id: `00000000-0000-4000-8000-${String(sequence).padStart(12, "0")}`,
                userId: input.userId,
                platform: input.platform,
                createdAt: input.now,
                ...columns,
            };
            rows.push(record);
            return { record: clone(record), relinked: false };
        },
        async updateTokens(id, input) {
            const record = byId(id);
            if (record.status !== "active" || record.refreshTokenEnc !== input.previousRefreshTokenEnc) return null;
            Object.assign(record, {
                accessTokenEnc: input.accessTokenEnc,
                refreshTokenEnc: input.refreshTokenEnc,
                tokenKeyVersion: input.tokenKeyVersion,
                accessTokenExpiresAt: input.accessTokenExpiresAt,
                lastValidatedAt: input.now,
                updatedAt: input.now,
            });
            return clone(record);
        },
        async markNeedsReconnect(id, reason, now, expectedRefreshTokenEnc) {
            const record = byId(id);
            if (record.status === "revoked") return null;
            if (expectedRefreshTokenEnc !== undefined && record.refreshTokenEnc !== expectedRefreshTokenEnc) return null;
            return clear(record, "needs_reconnect", reason, now);
        },
        async deleteById(id) {
            const index = rows.findIndex((row) => row.id === id);
            if (index >= 0) rows.splice(index, 1);
        },
        async markRevoked(id, reason, now) {
            return clear(byId(id), "revoked", reason, now);
        },
        async touchUsed(id, now) {
            byId(id).lastUsedAt = now;
        },
        async touchValidated(id, now) {
            byId(id).lastValidatedAt = now;
        },
        async findDormant(cutoff, limit) {
            return rows
                .filter((row) => row.status === "active" && (row.lastUsedAt ? row.lastUsedAt < cutoff : row.connectedAt < cutoff))
                .sort((a, b) => (a.lastUsedAt?.getTime() ?? 0) - (b.lastUsedAt?.getTime() ?? 0) || a.connectedAt.getTime() - b.connectedAt.getTime())
                .slice(0, limit)
                .map(clone);
        },
    };
}
