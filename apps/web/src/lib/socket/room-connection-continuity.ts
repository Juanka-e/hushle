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
