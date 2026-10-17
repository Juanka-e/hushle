import type { GameModeId, MatchFormat } from "@hushle/domain-game";

export const MATCH_END_REASONS = ["completed", "host_ended"] as const;
export type MatchEndReason = (typeof MATCH_END_REASONS)[number];

export const MATCH_SETTLEMENT_SNAPSHOT_VERSION = 1;

export const MATCH_PARTICIPANT_ROLES = [
    "Oyuncu",
    "Anlatıcı",
    "Gözetmen",
    "Tahminci",
    "İzleyici",
] as const;
export type MatchParticipantRole = (typeof MATCH_PARTICIPANT_ROLES)[number];

export interface MatchSettlementParticipant {
    playerId: string;
    userId: number | null;
    identityType: "registered" | "guest";
    usernameSnapshot: string | null;
    displayName: string;
    team: "A" | "B" | null;
    roleAtStart: MatchParticipantRole;
}

/**
 * Immutable record of a finished match. Guests stay in the snapshot so a later
 * account-claim flow needs no migration; IP addresses are never stored.
 */
export interface MatchSettlementSnapshot {
    version: typeof MATCH_SETTLEMENT_SNAPSHOT_VERSION;
    endReason: MatchEndReason;
    roomCode: string;
    gameMode: GameModeId;
    matchStartedAt: string;
    matchEndedAt: string;
    durationSeconds: number | null;
    matchFormat: MatchFormat;
    matchTarget: number;
    score: { A: number; B: number };
    participants: MatchSettlementParticipant[];
}

export interface RegisteredSettlementParticipant extends MatchSettlementParticipant {
    userId: number;
}
