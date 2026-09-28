export type AdminEmailDeliveryStatus =
    | "pending"
    | "processing"
    | "sent"
    | "dead_letter";

export interface AdminEmailDeliveryItem {
    id: string;
    userId: number | null;
    username: string | null;
    recipient: string;
    messageClass: "transactional" | "marketing";
    template: string;
    subject: string;
    status: AdminEmailDeliveryStatus;
    attemptCount: number;
    manualRetryCount: number;
    availableAt: string;
    lastAttemptAt: string | null;
    sentAt: string | null;
    lastError: string | null;
    createdAt: string;
    suppression: {
        reason: "hard_bounce" | "complaint" | "manual";
        scope: "all" | "marketing";
    } | null;
}

export interface AdminEmailDeliveryResponse {
    items: AdminEmailDeliveryItem[];
    page: number;
    pages: number;
    total: number;
    counts: Record<AdminEmailDeliveryStatus, number>;
}
