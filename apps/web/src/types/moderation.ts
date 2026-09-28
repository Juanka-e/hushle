export const MODERATION_ACTION_TYPES = [
    "suspend",
    "reactivate",
    "note",
] as const;

export type ModerationActionType = (typeof MODERATION_ACTION_TYPES)[number];

export interface ModerationEventView {
    id: number;
    actionType: ModerationActionType;
    reason: string;
    suspendedUntil: string | null;
    createdAt: string;
    actor: {
        id: number | null;
        username: string;
        role: string;
    } | null;
}

export interface AdminUserModerationView {
    id: number;
    username: string;
    email: string | null;
    emailVerifiedAt: string | null;
    role: string;
    createdAt: string;
    displayName: string | null;
    coinBalance: number;
    isSuspended: boolean;
    suspendedAt: string | null;
    suspendedUntil: string | null;
    suspensionReason: string | null;
    lastSeenAt: string | null;
    lastTrustedIp: string | null;
    registeredTrustedIp: string | null;
    lastUserAgent: string | null;
    supportTicketSummary: {
        total: number;
        openCount: number;
        latestTicketId: number | null;
        latestStatus: string | null;
        latestSubject: string | null;
        latestUpdatedAt: string | null;
    };
    walletAdjustmentSummary: {
        latestAdjustmentId: number | null;
        latestType: "credit" | "debit" | null;
        latestAmount: number | null;
        latestReason: string | null;
        latestCreatedAt: string | null;
    };
    recentModerationEvents: ModerationEventView[];
}

export interface AdminUserListResponse {
    users: AdminUserModerationView[];
    total: number;
    page: number;
    pages: number;
    trustProxyEnabled: boolean;
}
