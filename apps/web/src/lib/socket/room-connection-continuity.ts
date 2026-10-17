export interface ConnectionContinuityPlayer {
    playerId: string;
    team: "A" | "B" | null;
    online: boolean;
    spectator: boolean;
}

export interface ConnectionContinuityInput {
    active: boolean;
    players: ConnectionContinuityPlayer[];
    narratorPlayerId: string | null;
    inspectorPlayerId: string | null;
}

export interface ConnectionContinuityDecision {
    canContinue: boolean;
    missingPlayerIds: string[];
}

export interface ActiveMatchDurationInput {
    startedAt: number | null;
    endedAt: number | null;
    now: number;
    pausedDurationMs: number;
    pauseStartedAt: number | null;
}

export function calculateActiveMatchDurationSeconds(
    input: ActiveMatchDurationInput
): number | null {
    if (input.startedAt === null) return null;

    const snapshotAt = input.endedAt ?? input.now;
    const currentPauseDurationMs = input.pauseStartedAt
        ? Math.max(0, snapshotAt - input.pauseStartedAt)
        : 0;

    return Math.max(
        0,
        Math.round(
            (snapshotAt -
                input.startedAt -
                Math.max(0, input.pausedDurationMs) -
                currentPauseDurationMs) /
                1000
        )
    );
}

export function resolveConnectionContinuity(
    input: ConnectionContinuityInput
): ConnectionContinuityDecision {
    if (!input.active) {
        return { canContinue: true, missingPlayerIds: [] };
    }

    const activePlayers = input.players.filter(
        (player) => !player.spectator && (player.team === "A" || player.team === "B")
    );
    const onlineIds = new Set(
        activePlayers.filter((player) => player.online).map((player) => player.playerId)
    );
    const missingIds = new Set<string>();

    for (const team of ["A", "B"] as const) {
        const teamPlayers = activePlayers.filter((player) => player.team === team);
        const onlineTeamPlayers = teamPlayers.filter((player) => player.online);
        if (teamPlayers.length >= 2 && onlineTeamPlayers.length < 2) {
            for (const player of teamPlayers) {
                if (!player.online) missingIds.add(player.playerId);
            }
        }
    }

    for (const rolePlayerId of [input.narratorPlayerId, input.inspectorPlayerId]) {
        if (rolePlayerId && !onlineIds.has(rolePlayerId)) {
            missingIds.add(rolePlayerId);
        }
    }

    return {
        canContinue: missingIds.size === 0,
        missingPlayerIds: [...missingIds],
    };
}

export const EMPTY_LOBBY_GRACE_MS = 15_000;

/**
 * Only an interrupted match is worth keeping when everyone is offline; an empty
 * lobby or finished match frees its capacity slot after a short grace period.
 */
export function resolveAbandonedRoomTtlMs(input: {
    matchActive: boolean;
    abandonedMatchTtlMs: number;
}): number {
    return input.matchActive ? input.abandonedMatchTtlMs : EMPTY_LOBBY_GRACE_MS;
}

export const CONNECTION_PAUSE_GRACE_MS = 60_000;

/** How long the host must wait before resolving a connection pause. */
export function getConnectionPauseResolutionWindow(input: {
    startedAt: number;
    now: number;
    graceMs?: number;
}): { available: boolean; secondsRemaining: number } {
    const graceMs = input.graceMs ?? CONNECTION_PAUSE_GRACE_MS;
    const elapsed = Math.max(0, input.now - input.startedAt);
    const remainingMs = Math.max(0, graceMs - elapsed);
    return {
        available: remainingMs === 0,
        secondsRemaining: Math.ceil(remainingMs / 1000),
    };
}

/** Continuing without the missing players must leave two online players per team. */
export function evaluateContinueWithoutMissing(input: {
    players: ConnectionContinuityPlayer[];
    missingPlayerIds: string[];
}): { allowed: true } | { allowed: false; reason: "nothing_missing" | "team_below_minimum" } {
    if (input.missingPlayerIds.length === 0) {
        return { allowed: false, reason: "nothing_missing" };
    }
    const missing = new Set(input.missingPlayerIds);
    for (const team of ["A", "B"] as const) {
        const remaining = input.players.filter(
            (player) =>
                player.team === team &&
                !player.spectator &&
                player.online &&
                !missing.has(player.playerId)
        );
        if (remaining.length < 2) {
            return { allowed: false, reason: "team_below_minimum" };
        }
    }
    return { allowed: true };
}

export type ConnectionPauseTrigger = "narrator" | "inspector" | "team_below_minimum";

/** The most critical missing role names the pause for analytics. */
export function classifyConnectionPauseTrigger(input: {
    missingPlayerIds: string[];
    narratorPlayerId: string | null;
    inspectorPlayerId: string | null;
}): ConnectionPauseTrigger {
    if (input.narratorPlayerId && input.missingPlayerIds.includes(input.narratorPlayerId)) {
        return "narrator";
    }
    if (input.inspectorPlayerId && input.missingPlayerIds.includes(input.inspectorPlayerId)) {
        return "inspector";
    }
    return "team_below_minimum";
}
