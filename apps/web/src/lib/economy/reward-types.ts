export const REWARD_SOURCES = [
    "match_reward",
    "promo_claim",
    "admin_adjustment",
    "mission_reward_daily",
    "mission_reward_weekly",
    "event_reward",
    "comeback_reward",
] as const;

export type RewardSource = (typeof REWARD_SOURCES)[number];

export const REWARD_DECISIONS = [
    "deny",
    "allow_full",
    "allow_reduced",
] as const;

export type RewardDecision = (typeof REWARD_DECISIONS)[number];

export const REWARD_REASON_CODES = [
    "already_claimed",
    "room_not_found",
    "match_not_completed",
    "participant_not_found",
    "spectator_not_eligible",
    "invalid_base_reward",
] as const;

export type RewardReasonCode = (typeof REWARD_REASON_CODES)[number];

export const REWARD_REVIEW_FLAGS = [
    "single_authenticated_player_room",
    "guest_majority_room",
    "small_room_lineup",
] as const;

export type RewardReviewFlag = (typeof REWARD_REVIEW_FLAGS)[number];

export interface RewardLineupIdentity {
    playerId: string;
    userId: number | null;
    identityType: "registered" | "guest";
    usernameSnapshot: string | null;
    displayNameSnapshot: string;
    team: "A" | "B" | null;
    roleAtStart: string;
}

export interface RewardRoomMetrics {
    totalPlayers: number;
    authenticatedPlayers: number;
    guestPlayers: number;
    matchStartedAt: string | null;
    sureSeconds: number | null;
    lineupPlayers: string[];
    lineupIdentities: RewardLineupIdentity[];
}

export interface RewardModifierSummary {
    rewardMultiplier: number;
    weekendBoostApplied: boolean;
    reducedByRules: boolean;
}

export interface RewardEligibilityDenied {
    source: RewardSource;
    decision: "deny";
    reasonCodes: RewardReasonCode[];
    reviewFlags: RewardReviewFlag[];
    roomMetrics: RewardRoomMetrics;
}

export interface RewardEligibilityAllowed {
    source: RewardSource;
    decision: "allow_full" | "allow_reduced";
    reasonCodes: [];
    reviewFlags: RewardReviewFlag[];
    roomMetrics: RewardRoomMetrics;
    baseRewardCoin: number;
    finalRewardCoin: number;
    won: boolean;
    modifiers: RewardModifierSummary;
    participantPlayerId: string;
    participantTeam: "A" | "B" | null;
    lineupKey: string | null;
}

export type RewardEligibilityResult =
    | RewardEligibilityDenied
    | RewardEligibilityAllowed;
