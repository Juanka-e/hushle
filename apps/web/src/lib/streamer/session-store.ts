import { randomUUID } from "node:crypto";
import { prisma, Prisma, StreamSessionStatus } from "@hushle/platform-db";
import type { StreamerPlatform } from "@hushle/platform-streamer";

// The persistence seam for stream sessions and their round results. Prisma behind it in the
// app; an in-memory twin for the runtime and service tests. Live game state never lives here:
// rows record who opened what, how it ended and one line per finished round.

export type StreamSessionStatusValue = "active" | "ended" | "interrupted";
export type StreamRoundOutcomeValue = "solved" | "timeout" | "passed";

export interface StreamSessionSummary {
    /** Top 10 of the final ranking. */
    scores: Array<{ name: string; points: number; rank: number; tied: boolean }>;
    participants: number;
    rounds: number;
}

export interface StreamSessionRecord {
    id: string;
    userId: number;
    connectionId: string | null;
    platform: StreamerPlatform;
    status: StreamSessionStatusValue;
    /** The validated CreateSessionInput; read it back through the schema (older rows may differ). */
    settings: unknown;
    viewKeyHash: string;
    startedAt: Date;
    endedAt: Date | null;
    roundCount: number;
    summary: unknown;
    createdAt: Date;
    updatedAt: Date;
}

export interface CreateStreamSessionRow {
    userId: number;
    connectionId: string | null;
    platform: StreamerPlatform;
    settings: object;
    viewKeyHash: string;
    startedAt: Date;
}

export interface StreamSessionPatch {
    status?: StreamSessionStatusValue;
    endedAt?: Date | null;
    roundCount?: number;
    summary?: StreamSessionSummary | null;
    viewKeyHash?: string;
    settings?: object;
}

export interface StreamRoundResultInput {
    sessionId: string;
    round: number;
    wordId: number | null;
    outcome: StreamRoundOutcomeValue;
    winnerPlatformUserId: string | null;
    winnerName: string | null;
    solveMs: number | null;
    startedAt: Date;
    endedAt: Date;
}

export interface StreamSessionStore {
    create(row: CreateStreamSessionRow): Promise<StreamSessionRecord>;
    /** The newest `active` row of the user, if any. */
    findActiveByUser(userId: number): Promise<StreamSessionRecord | null>;
    findById(id: string): Promise<StreamSessionRecord | null>;
    findByViewKeyHash(hash: string): Promise<StreamSessionRecord | null>;
    update(id: string, patch: StreamSessionPatch): Promise<StreamSessionRecord>;
    /**
     * Interrupts the row only while it is still `active`; null when it no longer is (an end
     * that just landed is never overwritten).
     */
    markInterrupted(id: string, now: Date): Promise<StreamSessionRecord | null>;
    /** Boot reconciliation: every `active` row becomes `interrupted`; returns how many. */
    markInterruptedAll(now: Date): Promise<number>;
    addRoundResult(result: StreamRoundResultInput): Promise<void>;
    /** Newest first. */
    listRecent(userId: number, limit: number): Promise<StreamSessionRecord[]>;
}

const WINNER_ID_MAX = 64;
const WINNER_NAME_MAX = 100;

function roundResultColumns(result: StreamRoundResultInput): StreamRoundResultInput {
    return {
        ...result,
        winnerPlatformUserId: result.winnerPlatformUserId?.slice(0, WINNER_ID_MAX) ?? null,
        winnerName: result.winnerName?.slice(0, WINNER_NAME_MAX) ?? null,
    };
}

// ---------------------------------------------------------------- Prisma

function json(value: object): Prisma.InputJsonValue {
    return value as Prisma.InputJsonValue;
}

function patchColumns(patch: StreamSessionPatch): Prisma.StreamSessionUpdateInput {
    const data: Prisma.StreamSessionUpdateInput = {};
    if (patch.status !== undefined) data.status = patch.status;
    if (patch.endedAt !== undefined) data.endedAt = patch.endedAt;
    if (patch.roundCount !== undefined) data.roundCount = patch.roundCount;
    if (patch.summary !== undefined) data.summary = patch.summary === null ? Prisma.DbNull : json(patch.summary);
    if (patch.viewKeyHash !== undefined) data.viewKeyHash = patch.viewKeyHash;
    if (patch.settings !== undefined) data.settings = json(patch.settings);
    return data;
}

export const prismaStreamSessionStore: StreamSessionStore = {
    create(row) {
        return prisma.streamSession.create({
            data: {
                userId: row.userId,
                connectionId: row.connectionId,
                platform: row.platform,
                settings: json(row.settings),
                viewKeyHash: row.viewKeyHash,
                startedAt: row.startedAt,
            },
        });
    },
    findActiveByUser(userId) {
        return prisma.streamSession.findFirst({
            where: { userId, status: StreamSessionStatus.active },
            orderBy: [{ startedAt: "desc" }, { createdAt: "desc" }],
        });
    },
    findById(id) {
        return prisma.streamSession.findUnique({ where: { id } });
    },
    findByViewKeyHash(hash) {
        return prisma.streamSession.findUnique({ where: { viewKeyHash: hash } });
    },
    update(id, patch) {
        return prisma.streamSession.update({ where: { id }, data: patchColumns(patch) });
    },
    async markInterrupted(id, now) {
        const result = await prisma.streamSession.updateMany({
            where: { id, status: StreamSessionStatus.active },
            data: { status: StreamSessionStatus.interrupted, endedAt: now },
        });
        if (result.count === 0) return null;
        return prisma.streamSession.findUnique({ where: { id } });
    },
    async markInterruptedAll(now) {
        const result = await prisma.streamSession.updateMany({
            where: { status: StreamSessionStatus.active },
            data: { status: StreamSessionStatus.interrupted, endedAt: now },
        });
        return result.count;
    },
    async addRoundResult(result) {
        await prisma.streamRoundResult.create({ data: roundResultColumns(result) });
    },
    listRecent(userId, limit) {
        return prisma.streamSession.findMany({
            where: { userId },
            orderBy: [{ startedAt: "desc" }, { createdAt: "desc" }],
            take: limit,
        });
    },
};

// ---------------------------------------------------------------- memory (tests)

export interface MemoryStreamSessionStore extends StreamSessionStore {
    readonly rows: StreamSessionRecord[];
    readonly results: Array<StreamRoundResultInput & { id: number }>;
}

function uniqueViolation(target: string): Error {
    const error = new Error(`Unique constraint failed on ${target}`) as Error & { code: string };
    error.code = "P2002";
    return error;
}

export function createMemoryStreamSessionStore(): MemoryStreamSessionStore {
    const rows: StreamSessionRecord[] = [];
    const results: MemoryStreamSessionStore["results"] = [];
    const clone = (record: StreamSessionRecord): StreamSessionRecord => structuredClone(record);
    const newestFirst = (list: StreamSessionRecord[]) =>
        list
            .map((row, index) => ({ row, index }))
            .sort((a, b) => b.row.startedAt.getTime() - a.row.startedAt.getTime() || b.index - a.index)
            .map(({ row }) => row);

    return {
        rows,
        results,
        async create(row) {
            if (rows.some((existing) => existing.viewKeyHash === row.viewKeyHash)) throw uniqueViolation("view_key_hash");
            const record: StreamSessionRecord = {
                id: randomUUID(),
                userId: row.userId,
                connectionId: row.connectionId,
                platform: row.platform,
                status: "active",
                settings: structuredClone(row.settings),
                viewKeyHash: row.viewKeyHash,
                startedAt: row.startedAt,
                endedAt: null,
                roundCount: 0,
                summary: null,
                createdAt: row.startedAt,
                updatedAt: row.startedAt,
            };
            rows.push(record);
            return clone(record);
        },
        async findActiveByUser(userId) {
            const [record] = newestFirst(rows.filter((row) => row.userId === userId && row.status === "active"));
            return record ? clone(record) : null;
        },
        async findById(id) {
            const record = rows.find((row) => row.id === id);
            return record ? clone(record) : null;
        },
        async findByViewKeyHash(hash) {
            const record = rows.find((row) => row.viewKeyHash === hash);
            return record ? clone(record) : null;
        },
        async update(id, patch) {
            const record = rows.find((row) => row.id === id);
            if (!record) throw new Error("stream session not found");
            if (patch.viewKeyHash !== undefined && rows.some((row) => row !== record && row.viewKeyHash === patch.viewKeyHash)) {
                throw uniqueViolation("view_key_hash");
            }
            for (const [key, value] of Object.entries(patch)) {
                if (value !== undefined) Object.assign(record, { [key]: structuredClone(value) });
            }
            return clone(record);
        },
        async markInterrupted(id, now) {
            const record = rows.find((row) => row.id === id && row.status === "active");
            if (!record) return null;
            record.status = "interrupted";
            record.endedAt = now;
            return clone(record);
        },
        async markInterruptedAll(now) {
            let count = 0;
            for (const row of rows) {
                if (row.status !== "active") continue;
                row.status = "interrupted";
                row.endedAt = now;
                count += 1;
            }
            return count;
        },
        async addRoundResult(result) {
            if (results.some((row) => row.sessionId === result.sessionId && row.round === result.round)) {
                throw uniqueViolation("session_id, round");
            }
            results.push({ id: results.length + 1, ...roundResultColumns(result) });
        },
        async listRecent(userId, limit) {
            return newestFirst(rows.filter((row) => row.userId === userId)).slice(0, limit).map(clone);
        },
    };
}
