import {
    getRedisClient,
    getRedisKey,
    type RedisLikeClient,
} from "@hushle/platform-cache";

/**
 * Daily, aggregate-only counters for connection-aware match pauses.
 * Only enum labels, counts and second totals are stored; nothing that
 * identifies a player, a room or a network address.
 */

const DAY_MS = 24 * 60 * 60 * 1_000;
const DEFAULT_RETENTION_DAYS = 45;
const MIN_RETENTION_DAYS = 7;
const MAX_RETENTION_DAYS = 400;
const MAX_DURATION_SECONDS = 86_400;
const MAX_MISSING_COUNT = 40;

// ARGV[1] = retention in ms, then (field, increment) pairs.
// One EVAL per event keeps a day's hash consistent.
const RECORD_COUNTERS_SCRIPT = `
for index = 2, #ARGV, 2 do
  redis.call("HINCRBY", KEYS[1], ARGV[index], ARGV[index + 1])
end
redis.call("PEXPIRE", KEYS[1], ARGV[1])
return 1
`;

export type ConnectionPauseTrigger = "narrator" | "inspector" | "team_below_minimum";
export type ConnectionPauseOutcome =
    | "resumed_after_reconnect"
    | "continued_without_missing"
    | "ended_by_host"
    | "reset_by_host"
    | "abandoned";

const TRIGGERS: readonly ConnectionPauseTrigger[] = [
    "narrator",
    "inspector",
    "team_below_minimum",
];
const OUTCOMES: readonly ConnectionPauseOutcome[] = [
    "resumed_after_reconnect",
    "continued_without_missing",
    "ended_by_host",
    "reset_by_host",
    "abandoned",
];

export interface ConnectionPauseAnalyticsDay {
    date: string;
    paused: number;
    outcomes: Record<ConnectionPauseOutcome, number>;
}

export interface ConnectionPauseAnalyticsSummary {
    days: 7 | 30;
    enabled: boolean;
    available: boolean;
    paused: number;
    missingPlayers: number;
    byTrigger: Record<ConnectionPauseTrigger, number>;
    outcomes: Record<ConnectionPauseOutcome, number>;
    averageResolutionSeconds: Record<ConnectionPauseOutcome, number | null>;
    daily: ConnectionPauseAnalyticsDay[];
}

interface ConnectionPauseAnalyticsOptions {
    env?: NodeJS.ProcessEnv;
    redis?: RedisLikeClient | null;
}

interface ConnectionPauseAnalyticsState {
    attempted: number;
    recorded: number;
    dropped: number;
    readRequests: number;
    readFailures: number;
}

type ConnectionPauseAnalyticsGlobal = typeof globalThis & {
    __hushleConnectionPauseAnalyticsState?: ConnectionPauseAnalyticsState;
};

function state(): ConnectionPauseAnalyticsState {
    const globalState = globalThis as ConnectionPauseAnalyticsGlobal;
    globalState.__hushleConnectionPauseAnalyticsState ??= {
        attempted: 0,
        recorded: 0,
        dropped: 0,
        readRequests: 0,
        readFailures: 0,
    };
    return globalState.__hushleConnectionPauseAnalyticsState;
}

function isEnabled(env: NodeJS.ProcessEnv): boolean {
    return env.CONNECTION_PAUSE_ANALYTICS_ENABLED?.trim().toLowerCase() !== "false";
}

function retentionDays(env: NodeJS.ProcessEnv): number {
    const raw = env.CONNECTION_PAUSE_ANALYTICS_RETENTION_DAYS?.trim();
    if (!raw) return DEFAULT_RETENTION_DAYS;
    const parsed = Number(raw);
    return Number.isSafeInteger(parsed)
        && parsed >= MIN_RETENTION_DAYS
        && parsed <= MAX_RETENTION_DAYS
        ? parsed
        : DEFAULT_RETENTION_DAYS;
}

function clampInteger(value: number, max: number): number {
    if (typeof value !== "number" || Number.isNaN(value)) return 0;
    return Math.min(max, Math.max(0, Math.round(value)));
}

function utcDay(value: Date): string {
    return value.toISOString().slice(0, 10);
}

function dailyKey(date: Date): string {
    return getRedisKey("telemetry", "daily", utcDay(date), "connection-pause");
}

async function resolveRedis(
    options: ConnectionPauseAnalyticsOptions | undefined
): Promise<RedisLikeClient | null> {
    if (options && "redis" in options) return options.redis ?? null;
    return getRedisClient();
}

type CounterIncrements = Array<[field: string, amount: number]>;

async function recordCounters(
    input: { occurredAt: Date },
    buildIncrements: () => CounterIncrements | null,
    options: ConnectionPauseAnalyticsOptions | undefined
): Promise<void> {
    const env = options?.env ?? process.env;
    if (!isEnabled(env)) return;
    const currentState = state();
    currentState.attempted += 1;

    try {
        const increments = buildIncrements();
        if (!increments) {
            currentState.dropped += 1;
            return;
        }
        const key = dailyKey(input.occurredAt);
        const redis = await resolveRedis(options);
        if (!redis) {
            currentState.dropped += 1;
            return;
        }

        await redis.eval(RECORD_COUNTERS_SCRIPT, {
            keys: [key],
            arguments: [
                String(retentionDays(env) * DAY_MS),
                ...increments.flatMap(([field, amount]) => [field, String(amount)]),
            ],
        });
        currentState.recorded += 1;
    } catch {
        currentState.dropped += 1;
    }
}

export async function recordConnectionPauseStarted(
    input: { occurredAt: Date; trigger: ConnectionPauseTrigger; missingCount: number },
    options?: { env?: NodeJS.ProcessEnv; redis?: RedisLikeClient | null }
): Promise<void> {
    await recordCounters(
        input,
        () => TRIGGERS.includes(input.trigger)
            ? [
                ["paused", 1],
                [`trigger:${input.trigger}`, 1],
                ["missing_players", clampInteger(input.missingCount, MAX_MISSING_COUNT)],
            ]
            : null,
        options
    );
}

export async function recordConnectionPauseResolved(
    input: { occurredAt: Date; outcome: ConnectionPauseOutcome; durationSeconds: number },
    options?: { env?: NodeJS.ProcessEnv; redis?: RedisLikeClient | null }
): Promise<void> {
    await recordCounters(
        input,
        () => OUTCOMES.includes(input.outcome)
            ? [
                [`outcome:${input.outcome}`, 1],
                [
                    `outcome:${input.outcome}:duration_seconds`,
                    clampInteger(input.durationSeconds, MAX_DURATION_SECONDS),
                ],
            ]
            : null,
        options
    );
}

function outcomeRecord<T>(value: () => T): Record<ConnectionPauseOutcome, T> {
    return Object.fromEntries(OUTCOMES.map((outcome) => [outcome, value()])) as Record<
        ConnectionPauseOutcome,
        T
    >;
}

function triggerRecord(): Record<ConnectionPauseTrigger, number> {
    return Object.fromEntries(TRIGGERS.map((trigger) => [trigger, 0])) as Record<
        ConnectionPauseTrigger,
        number
    >;
}

function windowDates(days: number, now: Date): Date[] {
    const reference = Number.isFinite(now.getTime()) ? now : new Date();
    const today = Date.UTC(
        reference.getUTCFullYear(),
        reference.getUTCMonth(),
        reference.getUTCDate()
    );
    return Array.from({ length: days }, (_, index) =>
        new Date(today - (days - 1 - index) * DAY_MS)
    );
}

const READ_FIELDS = [
    "paused",
    "missing_players",
    ...TRIGGERS.map((trigger) => `trigger:${trigger}`),
    ...OUTCOMES.map((outcome) => `outcome:${outcome}`),
    ...OUTCOMES.map((outcome) => `outcome:${outcome}:duration_seconds`),
];

function parseCounter(raw: string | null | undefined): number {
    const value = Number.parseInt(raw ?? "0", 10);
    return Number.isSafeInteger(value) && value > 0 ? value : 0;
}

function emptySummary(
    days: 7 | 30,
    enabled: boolean,
    dates: Date[]
): ConnectionPauseAnalyticsSummary {
    return {
        days,
        enabled,
        available: false,
        paused: 0,
        missingPlayers: 0,
        byTrigger: triggerRecord(),
        outcomes: outcomeRecord(() => 0),
        averageResolutionSeconds: outcomeRecord<number | null>(() => null),
        daily: dates.map((date) => ({
            date: utcDay(date),
            paused: 0,
            outcomes: outcomeRecord(() => 0),
        })),
    };
}

export async function getConnectionPauseAnalytics(
    input: { days: 7 | 30; now?: Date },
    options?: { env?: NodeJS.ProcessEnv; redis?: RedisLikeClient | null }
): Promise<ConnectionPauseAnalyticsSummary> {
    const days: 7 | 30 = input.days === 30 ? 30 : 7;
    const enabled = isEnabled(options?.env ?? process.env);
    const dates = windowDates(days, input.now ?? new Date());
    const currentState = state();
    currentState.readRequests += 1;

    try {
        const redis = await resolveRedis(options);
        if (!redis?.hmGet) {
            currentState.readFailures += 1;
            return emptySummary(days, enabled, dates);
        }
        const hmGet = redis.hmGet.bind(redis);
        const rows = await Promise.all(
            dates.map(async (date) => {
                const values = await hmGet(dailyKey(date), READ_FIELDS);
                return Object.fromEntries(
                    READ_FIELDS.map((field, index) => [field, parseCounter(values[index])])
                ) as Record<string, number>;
            })
        );

        const summary = emptySummary(days, enabled, dates);
        summary.available = true;
        const durationTotals = outcomeRecord(() => 0);
        rows.forEach((row, index) => {
            const dailyRow = summary.daily[index];
            dailyRow.paused = row.paused;
            summary.paused += row.paused;
            summary.missingPlayers += row.missing_players;
            for (const trigger of TRIGGERS) {
                summary.byTrigger[trigger] += row[`trigger:${trigger}`];
            }
            for (const outcome of OUTCOMES) {
                dailyRow.outcomes[outcome] = row[`outcome:${outcome}`];
                summary.outcomes[outcome] += row[`outcome:${outcome}`];
                durationTotals[outcome] += row[`outcome:${outcome}:duration_seconds`];
            }
        });
        for (const outcome of OUTCOMES) {
            const samples = summary.outcomes[outcome];
            summary.averageResolutionSeconds[outcome] = samples > 0
                ? Math.round((durationTotals[outcome] / samples) * 10) / 10
                : null;
        }
        return summary;
    } catch {
        currentState.readFailures += 1;
        return emptySummary(days, enabled, dates);
    }
}

export function getConnectionPauseAnalyticsStatus(): {
    enabled: boolean;
    attempted: number;
    recorded: number;
    dropped: number;
    readRequests: number;
    readFailures: number;
} {
    const currentState = state();
    return {
        enabled: isEnabled(process.env),
        attempted: currentState.attempted,
        recorded: currentState.recorded,
        dropped: currentState.dropped,
        readRequests: currentState.readRequests,
        readFailures: currentState.readFailures,
    };
}
