export interface AdminMatchLineupIdentity {
    playerId: string;
    userId: number | null;
    identityType: "registered" | "guest";
    usernameSnapshot: string | null;
    displayNameSnapshot: string;
    team: "A" | "B" | null;
}

export interface AdminMatchHistoryItem {
    id: number;
    roomCode: string;
    gameType: string;
    matchStartedAt: string;
    matchEndedAt: string | null;
    matchDurationSeconds: number | null;
    matchFormat: "tur" | "skor" | null;
    matchTarget: number | null;
    playerId: string;
    team: "A" | "B" | null;
    won: boolean;
    scoreA: number;
    scoreB: number;
    coinEarned: number;
    lineupPlayerCount: number;
    lineupAuthenticatedCount: number;
    lineupGuestCount: number;
    createdAt: string;
    review: {
        auditSource: "hot" | "archive";
        eligibilityReasons: string[];
        reviewFlags: string[];
        requestedRewardCoin: number | null;
        allowedRewardCoin: number | null;
        blockedRewardCoin: number | null;
        rewardGuardTriggered: boolean;
        rewardGuardBand: string | null;
        repeatedGroupTriggered: boolean;
        lineupIdentities: AdminMatchLineupIdentity[];
    } | null;
}

export interface AdminMatchHistoryResponse {
    user: {
        id: number;
        username: string;
        displayName: string | null;
    };
    matches: AdminMatchHistoryItem[];
    total: number;
    page: number;
    pages: number;
    summary: {
        wins: number;
        totalCoinEarned: number;
        averageDurationSeconds: number | null;
        durationSampleCount: number;
    };
}
