import {
    getRedisClient,
    getRedisKey,
    type RedisLikeClient,
} from "@hushle/platform-cache";

const DAY_MS = 24 * 60 * 60 * 1_000;
const RECORD_WORD_SCRIPT = `
redis.call("HINCRBY", KEYS[1], ARGV[1] .. ":shown", 1)
redis.call("HINCRBY", KEYS[1], ARGV[1] .. ":" .. ARGV[2], 1)
redis.call("HINCRBY", KEYS[1], ARGV[1] .. ":exposure_seconds", ARGV[3])
redis.call("HINCRBY", KEYS[1], ARGV[1] .. ":difficulty:" .. ARGV[4], 1)
redis.call("PEXPIRE", KEYS[1], ARGV[5])
for index = 6, #ARGV do
  local prefix = "category:" .. ARGV[index]
  redis.call("HINCRBY", KEYS[2], prefix .. ":shown", 1)
  redis.call("HINCRBY", KEYS[2], prefix .. ":" .. ARGV[2], 1)
  redis.call("HINCRBY", KEYS[2], prefix .. ":exposure_seconds", ARGV[3])
end
redis.call("PEXPIRE", KEYS[2], ARGV[5])
return 1
`;

export type WordAnalyticsOutcome = "dogru" | "tabu" | "pas" | "timeout";

export interface WordAnalyticsInput {
    occurredAt: Date;
    wordId: number;
    categoryIds: number[];
    difficulty: 1 | 2 | 3;
    outcome: WordAnalyticsOutcome;
    exposureSeconds: number;
}

export interface WordAnalyticsSummary {
    shown: number;
    dogru: number;
    tabu: number;
    pas: number;
    timeout: number;
    exposureSeconds: number;
}

interface WordAnalyticsState {
    attempted: number;
    recorded: number;
    dropped: number;
    readRequests: number;
    readFailures: number;
}

type WordAnalyticsGlobal = typeof globalThis & {
    __hushleWordAnalyticsState?: WordAnalyticsState;
};

function state(): WordAnalyticsState {
    const globalState = globalThis as WordAnalyticsGlobal;
    globalState.__hushleWordAnalyticsState ??= {
        attempted: 0,
        recorded: 0,
        dropped: 0,
        readRequests: 0,
        readFailures: 0,
    };
    return globalState.__hushleWordAnalyticsState;
}

function emptySummary(): WordAnalyticsSummary {
    return { shown: 0, dogru: 0, tabu: 0, pas: 0, timeout: 0, exposureSeconds: 0 };
}

function retentionDays(): number {
    const parsed = Number(process.env.WORD_ANALYTICS_RETENTION_DAYS ?? "45");
    return Number.isSafeInteger(parsed) && parsed >= 7 && parsed <= 400 ? parsed : 45;
}

function enabled(): boolean {
    return process.env.WORD_ANALYTICS_ENABLED?.trim().toLowerCase() === "true";
}

function day(value: Date): string {
    return value.toISOString().slice(0, 10);
}

export function getWordAnalyticsKey(date: Date): string {
    return getRedisKey("analytics", "word", "daily", `{${day(date)}}`);
}

export function getCategoryWordAnalyticsKey(date: Date): string {
    return getRedisKey("analytics", "category", "daily", `{${day(date)}}`);
}

export async function recordWordAnalytics(
    input: WordAnalyticsInput,
    options?: { redis?: RedisLikeClient | null; forceEnabled?: boolean }
): Promise<boolean> {
    if (!(options?.forceEnabled ?? enabled())) return false;
    if (!Number.isSafeInteger(input.wordId) || input.wordId <= 0) return false;
    const currentState = state();
    currentState.attempted += 1;

    try {
        const redis = options && "redis" in options
            ? options.redis ?? null
            : await getRedisClient();
        if (!redis) {
            currentState.dropped += 1;
            return false;
        }

        const categoryIds = [...new Set(input.categoryIds)]
            .filter((id) => Number.isSafeInteger(id) && id > 0)
            .slice(0, 10);
        await redis.eval(RECORD_WORD_SCRIPT, {
            keys: [
                getWordAnalyticsKey(input.occurredAt),
                getCategoryWordAnalyticsKey(input.occurredAt),
            ],
            arguments: [
                `word:${input.wordId}`,
                input.outcome,
                String(Math.max(0, Math.trunc(input.exposureSeconds))),
                String(input.difficulty),
                String(retentionDays() * DAY_MS),
                ...categoryIds.map(String),
            ],
        });
        currentState.recorded += 1;
        return true;
    } catch {
        currentState.dropped += 1;
        return false;
    }
}

export async function getWordAnalyticsSummaries(
    wordIds: number[],
    days: number,
    options?: { redis?: RedisLikeClient | null; now?: Date }
): Promise<Record<number, WordAnalyticsSummary>> {
    const boundedIds = [...new Set(wordIds)]
        .filter((id) => Number.isSafeInteger(id) && id > 0)
        .slice(0, 100);
    const boundedDays = Number.isFinite(days)
        ? Math.min(30, Math.max(1, Math.trunc(days)))
        : 7;
    const result = Object.fromEntries(boundedIds.map((id) => [id, emptySummary()]));
    if (boundedIds.length === 0) return result;
    if (!enabled() && !(options && "redis" in options)) return result;
    const currentState = state();
    currentState.readRequests += 1;

    try {
        const redis = options && "redis" in options
            ? options.redis ?? null
            : await getRedisClient();
        if (!redis?.hmGet) {
            currentState.readFailures += 1;
            return result;
        }

        const now = options?.now ?? new Date();
        const metrics = ["shown", "dogru", "tabu", "pas", "timeout", "exposure_seconds"] as const;
        const fields = boundedIds.flatMap((wordId) =>
            metrics.map((metric) => `word:${wordId}:${metric}`)
        );
        await Promise.all(Array.from({ length: boundedDays }, async (_, offset) => {
            const date = new Date(now);
            date.setUTCDate(date.getUTCDate() - offset);
            const values = await redis.hmGet!(getWordAnalyticsKey(date), fields);
            boundedIds.forEach((wordId, wordIndex) => {
                metrics.forEach((metric, metricIndex) => {
                    const raw = values[wordIndex * metrics.length + metricIndex];
                    const value = Math.max(0, Number.parseInt(raw ?? "0", 10) || 0);
                    if (metric === "exposure_seconds") result[wordId].exposureSeconds += value;
                    else result[wordId][metric] += value;
                });
            });
        }));
        return result;
    } catch {
        currentState.readFailures += 1;
        return result;
    }
}

export function getWordAnalyticsStatus() {
    return {
        enabled: enabled(),
        retentionDays: retentionDays(),
        backend: "redis" as const,
        rawEventsStored: false,
        maxReaderDays: 30,
        maxReaderWordIds: 100,
        ...state(),
    };
}

export function resetWordAnalyticsState(): void {
    const currentState = state();
    currentState.attempted = 0;
    currentState.recorded = 0;
    currentState.dropped = 0;
    currentState.readRequests = 0;
    currentState.readFailures = 0;
}
