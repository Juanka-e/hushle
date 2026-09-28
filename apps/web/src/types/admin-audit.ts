export interface AdminAuditActorView {
    id: number | null;
    username: string | null;
    role: string;
}

export interface AdminAuditLogView {
    id: number;
    source: "hot" | "archive";
    archivedAt: string | null;
    action: string;
    resourceType: string;
    resourceId: string | null;
    summary: string | null;
    note: string | null;
    ipAddress: string | null;
    userAgent: string | null;
    createdAt: string;
    actor: AdminAuditActorView | null;
    metadata: Record<string, string>;
    economyGuard: {
        rewardSource: string | null;
        requestedRewardCoin: number | null;
        allowedRewardCoin: number | null;
        blockedRewardCoin: number | null;
        rewardGuardTriggered: boolean;
        rewardGuardBand: string | null;
        repeatedGroupTriggered: boolean;
        repeatedGroupOrdinal: number | null;
        repeatedGroupThreshold: number | null;
        roomCode: string | null;
        sureSeconds: number | null;
        lineupPlayers: string[];
        lineupIdentities: Array<{
            playerId: string;
            userId: number | null;
            identityType: "registered" | "guest";
            usernameSnapshot: string | null;
            displayNameSnapshot: string;
            team: "A" | "B" | null;
        }>;
    } | null;
}

export interface AdminAuditListResponse {
    logs: AdminAuditLogView[];
    source: "hot" | "archive";
    total: number;
    page: number;
    pages: number;
    actionOptions: string[];
    resourceTypeOptions: string[];
    roleOptions: string[];
}
