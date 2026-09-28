import type { Prisma } from "@hushle/platform-db";
import { getOrSetJsonCache } from "@hushle/platform-cache";
import {
    getNotificationUnreadCountCacheKey,
    invalidateNotificationUnreadCountCache,
} from "@/lib/cache/application-cache";
import { prisma } from "@/lib/prisma";
import type {
    NotificationListResponse,
    NotificationType,
    NotificationUnreadCountResponse,
    NotificationView,
} from "@/types/notifications";
import type { NotificationListQuery } from "@/lib/notifications/schema";

type NotificationCreateData = {
    userId: number;
    type: NotificationType;
    title: string;
    body: string;
    resourceType: string | null;
    resourceId: string | null;
    actionLabel: string | null;
    actionHref: string | null;
    metadata?: Prisma.InputJsonValue;
};

type NotificationCreateClient = {
    notification: {
        create: (args: { data: NotificationCreateData }) => Promise<unknown>;
    };
};

type NotificationQueryClient = {
    notification: {
        findMany: (args: {
            where: Record<string, unknown>;
            orderBy: Array<Record<string, "asc" | "desc">>;
            take: number;
            select: Record<string, boolean>;
        }) => Promise<NotificationRecord[]>;
        count: (args: { where: Record<string, unknown> }) => Promise<number>;
        updateMany: (args: {
            where: Record<string, unknown>;
            data: Record<string, unknown>;
        }) => Promise<{ count: number }>;
    };
};

type NotificationRecord = {
    id: number;
    type: NotificationType;
    title: string;
    body: string;
    resourceType: string | null;
    resourceId: string | null;
    actionLabel: string | null;
    actionHref: string | null;
    isRead: boolean;
    readAt: Date | null;
    archivedAt: Date | null;
    createdAt: Date;
};

export interface CreateUserNotificationInput {
    userId: number;
    type: NotificationType;
    title: string;
    body: string;
    resourceType?: string | null;
    resourceId?: string | number | null;
    actionLabel?: string | null;
    actionHref?: string | null;
    metadata?: Prisma.InputJsonValue | null;
}

export function shouldCreateSupportStatusNotification(
    previousStatus: string,
    nextStatus: string
): boolean {
    return previousStatus !== nextStatus && (nextStatus === "resolved" || nextStatus === "closed");
}

function mapNotification(notification: NotificationRecord): NotificationView {
    return {
        id: notification.id,
        type: notification.type,
        title: notification.title,
        body: notification.body,
        resourceType: notification.resourceType,
        resourceId: notification.resourceId,
        actionLabel: notification.actionLabel,
        actionHref: notification.actionHref,
        isRead: notification.isRead,
        readAt: notification.readAt?.toISOString() ?? null,
        archivedAt: notification.archivedAt?.toISOString() ?? null,
        createdAt: notification.createdAt.toISOString(),
    };
}

export async function createUserNotificationWithClient(
    db: NotificationCreateClient,
    input: CreateUserNotificationInput,
    options?: { deferCacheInvalidation?: boolean }
): Promise<void> {
    await db.notification.create({
        data: {
            userId: input.userId,
            type: input.type,
            title: input.title.slice(0, 160),
            body: input.body.slice(0, 500),
            resourceType: input.resourceType?.slice(0, 80) ?? null,
            resourceId:
                input.resourceId !== undefined && input.resourceId !== null
                    ? String(input.resourceId).slice(0, 120)
                    : null,
            actionLabel: input.actionLabel?.slice(0, 40) ?? null,
            actionHref: input.actionHref?.slice(0, 255) ?? null,
            metadata: input.metadata ?? undefined,
        },
    });
    if (!options?.deferCacheInvalidation) {
        await invalidateNotificationUnreadCountCache(input.userId);
    }
}

async function loadNotificationUnreadCount(userId: number): Promise<number> {
    const notificationClient = prisma as unknown as NotificationQueryClient;
    const result = await getOrSetJsonCache<{ unreadCount: number }>({
        key: getNotificationUnreadCountCacheKey(userId),
        ttlMs: 10_000,
        loader: async () => ({
            unreadCount: await notificationClient.notification.count({
                where: {
                    userId,
                    isRead: false,
                    archivedAt: null,
                },
            }),
        }),
    });

    return result.value.unreadCount;
}

export async function listNotificationsForUser(
    userId: number,
    query: NotificationListQuery
): Promise<NotificationListResponse> {
    const notificationClient = prisma as unknown as NotificationQueryClient;
    const where = {
        userId,
        archivedAt: null,
        ...(query.filter === "unread" ? { isRead: false } : {}),
    };

    const [notifications, unreadCount] = await Promise.all([
        notificationClient.notification.findMany({
            where,
            orderBy: [{ createdAt: "desc" }, { id: "desc" }],
            take: query.limit,
            select: {
                id: true,
                type: true,
                title: true,
                body: true,
                resourceType: true,
                resourceId: true,
                actionLabel: true,
                actionHref: true,
                isRead: true,
                readAt: true,
                archivedAt: true,
                createdAt: true,
            },
        }),
        loadNotificationUnreadCount(userId),
    ]);

    return {
        notifications: notifications.map((notification) =>
            mapNotification(notification as NotificationRecord)
        ),
        unreadCount,
        limit: query.limit,
    };
}

export async function getNotificationUnreadCountForUser(
    userId: number
): Promise<NotificationUnreadCountResponse> {
    return { unreadCount: await loadNotificationUnreadCount(userId) };
}

export async function markNotificationReadForUser(
    notificationId: number,
    userId: number
): Promise<boolean> {
    const notificationClient = prisma as unknown as NotificationQueryClient;
    const records = await notificationClient.notification.findMany({
        where: {
            id: notificationId,
            userId,
            archivedAt: null,
        },
        orderBy: [{ createdAt: "desc" }],
        take: 1,
        select: {
            id: true,
            type: true,
            title: true,
            body: true,
            resourceType: true,
            resourceId: true,
            actionLabel: true,
            actionHref: true,
            isRead: true,
            readAt: true,
            archivedAt: true,
            createdAt: true,
        },
    });

    const target = records[0] as NotificationRecord | undefined;
    if (!target) {
        return false;
    }

    if (target.isRead) {
        return true;
    }

    const result = await notificationClient.notification.updateMany({
        where: {
            id: notificationId,
            userId,
            archivedAt: null,
        },
        data: {
            isRead: true,
            readAt: new Date(),
        },
    });

    const updated = result.count === 1;
    if (updated) {
        await invalidateNotificationUnreadCountCache(userId);
    }
    return updated;
}

export async function markAllNotificationsReadForUser(userId: number): Promise<number> {
    const notificationClient = prisma as unknown as NotificationQueryClient;
    const result = await notificationClient.notification.updateMany({
        where: {
            userId,
            isRead: false,
            archivedAt: null,
        },
        data: {
            isRead: true,
            readAt: new Date(),
        },
    });

    if (result.count > 0) {
        await invalidateNotificationUnreadCountCache(userId);
    }
    return result.count;
}

export async function archiveNotificationForUser(
    notificationId: number,
    userId: number
): Promise<{ updated: boolean; unreadArchived: boolean }> {
    const notificationClient = prisma as unknown as NotificationQueryClient;
    const records = await notificationClient.notification.findMany({
        where: {
            id: notificationId,
            userId,
            archivedAt: null,
        },
        orderBy: [{ createdAt: "desc" }],
        take: 1,
        select: {
            id: true,
            type: true,
            title: true,
            body: true,
            resourceType: true,
            resourceId: true,
            actionLabel: true,
            actionHref: true,
            isRead: true,
            readAt: true,
            archivedAt: true,
            createdAt: true,
        },
    });

    const target = records[0] as NotificationRecord | undefined;
    if (!target) {
        return { updated: false, unreadArchived: false };
    }

    const result = await notificationClient.notification.updateMany({
        where: {
            id: notificationId,
            userId,
            archivedAt: null,
        },
        data: {
            archivedAt: new Date(),
            ...(target.isRead ? {} : { isRead: true, readAt: new Date() }),
        },
    });

    const updated = result.count === 1;
    if (updated && !target.isRead) {
        await invalidateNotificationUnreadCountCache(userId);
    }

    return {
        updated,
        unreadArchived: !target.isRead,
    };
}

export async function archiveAllNotificationsForUser(
    userId: number
): Promise<{ archivedCount: number; unreadArchivedCount: number }> {
    const notificationClient = prisma as unknown as NotificationQueryClient;
    const unreadArchivedCount = await notificationClient.notification.count({
        where: {
            userId,
            isRead: false,
            archivedAt: null,
        },
    });

    const result = await notificationClient.notification.updateMany({
        where: {
            userId,
            archivedAt: null,
        },
        data: {
            archivedAt: new Date(),
            isRead: true,
            readAt: new Date(),
        },
    });

    if (unreadArchivedCount > 0) {
        await invalidateNotificationUnreadCountCache(userId);
    }
    return {
        archivedCount: result.count,
        unreadArchivedCount,
    };
}
