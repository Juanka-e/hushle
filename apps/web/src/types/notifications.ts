export const NOTIFICATION_TYPES = [
    "system",
    "support_reply",
    "support_status",
    "economy",
    "moderation",
] as const;

export type NotificationType = (typeof NOTIFICATION_TYPES)[number];

export interface NotificationView {
    id: number;
    type: NotificationType;
    title: string;
    body: string;
    resourceType: string | null;
    resourceId: string | null;
    actionLabel: string | null;
    actionHref: string | null;
    isRead: boolean;
    readAt: string | null;
    archivedAt: string | null;
    createdAt: string;
}

export interface NotificationListResponse {
    notifications: NotificationView[];
    unreadCount: number;
    limit: number;
}

export interface NotificationUnreadCountResponse {
    unreadCount: number;
}
