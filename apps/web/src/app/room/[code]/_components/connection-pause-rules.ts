import type {
    ConnectionPauseMissingPlayer,
    ConnectionPauseSummary,
} from "@/types/game";

export interface ConnectionPauseResolverInput {
    isHost: boolean;
    hostOnline: boolean;
    selfIsSpectator: boolean;
    selfOnline: boolean;
}

/**
 * Mirrors the server rule for CONNECTION_PAUSE_RESOLVE_EVENT: the room host decides;
 * when the host is offline, any online player in the match (not a spectator) may.
 */
export function canResolveConnectionPause(input: ConnectionPauseResolverInput): boolean {
    if (!input.selfOnline) return false;
    if (input.isHost) return true;
    return !input.hostOnline && !input.selfIsSpectator;
}

export interface ConnectionPauseResolutionView {
    missingPlayers: ConnectionPauseMissingPlayer[];
    /** null when the server did not send resolution data (older server). */
    resolutionAvailableInSeconds: number | null;
    canContinueWithoutMissing: boolean;
}

/** Reads the optional resolution fields defensively; returns null when nothing is pending. */
export function readConnectionPauseResolution(
    summary: ConnectionPauseSummary | null | undefined
): ConnectionPauseResolutionView | null {
    if (!summary?.waitingForPlayers) return null;

    const seconds = summary.resolutionAvailableInSeconds;
    const missingPlayers = Array.isArray(summary.missingPlayers)
        ? summary.missingPlayers.filter(
              (player): player is ConnectionPauseMissingPlayer =>
                  Boolean(player) && typeof player.ad === "string"
          )
        : [];

    return {
        missingPlayers,
        resolutionAvailableInSeconds:
            typeof seconds === "number" && Number.isFinite(seconds)
                ? Math.max(0, Math.ceil(seconds))
                : null,
        canContinueWithoutMissing: summary.canContinueWithoutMissing === true,
    };
}
