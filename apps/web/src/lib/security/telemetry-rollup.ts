import {
    getRedisClient,
    getRedisKey,
    type RedisLikeClient,
} from "@hushle/platform-cache";

const DEFAULT_RETENTION_DAYS = 45;
const DAY_MS = 24 * 60 * 60 * 1_000;
const UPDATE_DAILY_ROLLUP_SCRIPT = `
redis.call("HINCRBY", KEYS[1], "matches", 1)
redis.call("HINCRBY", KEYS[1], "coin_earned", ARGV[1])
redis.call("HINCRBY", KEYS[1], "duration_seconds", ARGV[2])
redis.call("HINCRBY", KEYS[1], "players", ARGV[3])
redis.call("HINCRBY", KEYS[1], "registered_players", ARGV[4])
redis.call("HINCRBY", KEYS[1], "guest_players", ARGV[5])
redis.call("HINCRBY", KEYS[1], "wins", ARGV[6])
redis.call("PEXPIRE", KEYS[1], ARGV[7])
return 1
`;

export interface TelemetryRollupEnvironment {
    MATCH_FINALIZE_TELEMETRY_ROLLUP_ENABLED?: string;
    TELEMETRY_ROLLUP_RETENTION_DAYS?: string;
}

export interface TelemetryRollupConfig {
    enabled: boolean;
    retentionDays: number;
}

export interface MatchFinalizeAuditSignals {
    reviewFlags: string[];
    repeatedGroupTriggered: boolean;
    rewardGuardTriggered: boolean;
}

export interface MatchFinalizeTelemetryInput {
    occurredAt: Date;
    gameMode: string;
    coinEarned: number;
    durationSeconds: number | null;
    totalPlayers: number;
    authenticatedPlayers: number;
    guestPlayers: number;
    won: boolean;
}

export interface TelemetryRollupStatus {
    enabled: boolean;
    backend: "redis";
    scope: "non-triggered-finalize";
    retentionDays: number;
    attempted: number;
    recorded: number;
    auditFallbacks: number;
    lastRecordedAt: string | null;
    lastFailureAt: string | null;
}

interface TelemetryRollupState {
    attempted: number;
    recorded: number;
    auditFallbacks: number;
    lastRecordedAt: string | null;
    lastFailureAt: string | null;
}

type TelemetryGlobal = typeof globalThis & {
    __hushleTelemetryRollupState?: TelemetryRollupState;
};

function getState(): TelemetryRollupState {
    const globalState = globalThis as TelemetryGlobal;
    globalState.__hushleTelemetryRollupState ??= {
        attempted: 0,
        recorded: 0,
        auditFallbacks: 0,
        lastRecordedAt: null,
        lastFailureAt: null,
    };
    return globalState.__hushleTelemetryRollupState;
}

function parseBoolean(value: string | undefined): boolean {
    if (value === undefined || value.trim() === "") return false;
    const normalized = value.trim().toLowerCase();
    if (normalized !== "true" && normalized !== "false") {
        throw new Error(
            "MATCH_FINALIZE_TELEMETRY_ROLLUP_ENABLED must be true or false"
        );
    }
    return normalized === "true";
}

function parseRetentionDays(value: string | undefined): number {
    if (value === undefined || value.trim() === "") {
        return DEFAULT_RETENTION_DAYS;
    }
    const parsed = Number(value);
    if (!Number.isSafeInteger(parsed) || parsed < 7 || parsed > 400) {
        throw new Error(
            "TELEMETRY_ROLLUP_RETENTION_DAYS must be between 7 and 400"
        );
    }
    return parsed;
}

function normalizeDimension(value: string): string {
    const normalized = value.trim().toLowerCase().replace(/[^a-z0-9_-]/g, "-");
    return normalized.slice(0, 40) || "unknown";
}

function toNonNegativeInteger(value: number | null): number {
    return Math.max(0, Math.trunc(value ?? 0));
}

export function getTelemetryRollupConfig(
    env?: TelemetryRollupEnvironment
): TelemetryRollupConfig {
    const runtimeEnv = env ?? {
        MATCH_FINALIZE_TELEMETRY_ROLLUP_ENABLED:
            process.env.MATCH_FINALIZE_TELEMETRY_ROLLUP_ENABLED,
        TELEMETRY_ROLLUP_RETENTION_DAYS:
            process.env.TELEMETRY_ROLLUP_RETENTION_DAYS,
    };
    return {
        enabled: parseBoolean(
            runtimeEnv.MATCH_FINALIZE_TELEMETRY_ROLLUP_ENABLED
        ),
        retentionDays: parseRetentionDays(
            runtimeEnv.TELEMETRY_ROLLUP_RETENTION_DAYS
        ),
    };
}

export function requiresDetailedMatchFinalizeAudit(
    signals: MatchFinalizeAuditSignals
): boolean {
    return (
        signals.reviewFlags.length > 0 ||
        signals.repeatedGroupTriggered ||
        signals.rewardGuardTriggered
    );
}

export function getMatchFinalizeTelemetryKey(
    input: Pick<MatchFinalizeTelemetryInput, "occurredAt" | "gameMode">
): string {
    const day = input.occurredAt.toISOString().slice(0, 10);
    return getRedisKey(
        "telemetry",
        "daily",
        day,
        "game.match.finalize",
        normalizeDimension(input.gameMode)
    );
}

export async function recordMatchFinalizeTelemetry(
    input: MatchFinalizeTelemetryInput,
    options?: {
        env?: TelemetryRollupEnvironment;
        redis?: RedisLikeClient | null;
    }
): Promise<boolean> {
    const config = getTelemetryRollupConfig(options?.env);
    if (!config.enabled) return false;

    const state = getState();
    state.attempted += 1;
    const redis = options && "redis" in options
        ? options.redis
        : await getRedisClient();
    if (!redis) {
        state.auditFallbacks += 1;
        state.lastFailureAt = new Date().toISOString();
        return false;
    }

    try {
        await redis.eval(UPDATE_DAILY_ROLLUP_SCRIPT, {
            keys: [getMatchFinalizeTelemetryKey(input)],
            arguments: [
                String(toNonNegativeInteger(input.coinEarned)),
                String(toNonNegativeInteger(input.durationSeconds)),
                String(toNonNegativeInteger(input.totalPlayers)),
                String(toNonNegativeInteger(input.authenticatedPlayers)),
                String(toNonNegativeInteger(input.guestPlayers)),
                input.won ? "1" : "0",
                String(config.retentionDays * DAY_MS),
            ],
        });
        state.recorded += 1;
        state.lastRecordedAt = new Date().toISOString();
        return true;
    } catch {
        state.auditFallbacks += 1;
        state.lastFailureAt = new Date().toISOString();
        return false;
    }
}

export function getTelemetryRollupStatus(
    config: TelemetryRollupConfig = getTelemetryRollupConfig()
): TelemetryRollupStatus {
    return {
        enabled: config.enabled,
        backend: "redis",
        scope: "non-triggered-finalize",
        retentionDays: config.retentionDays,
        ...getState(),
    };
}

export function resetTelemetryRollupState(): void {
    const state = getState();
    state.attempted = 0;
    state.recorded = 0;
    state.auditFallbacks = 0;
    state.lastRecordedAt = null;
    state.lastFailureAt = null;
}
