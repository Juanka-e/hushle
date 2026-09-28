import type { Prisma } from "@hushle/platform-db";
import { getInventory } from "@hushle/platform-inventory";
import { createUserNotificationWithClient } from "@/lib/notifications/service";
import { invalidateNotificationUnreadCountCache } from "@/lib/cache/application-cache";
import { prisma } from "@/lib/prisma";
import type {
    AdminInventoryEquipSlot,
    AdminInventoryOperationResponse,
    AdminInventoryRecentOperation,
    AdminInventorySummary,
    AdminInventoryUserOption,
    AdminUserInventoryView,
} from "@/types/admin-inventory-operations";

function createEmptySummary(): AdminInventorySummary {
    return {
        totalItems: 0,
        equippedItems: 0,
        byType: {
            avatar: 0,
            frame: 0,
            card_back: 0,
            card_face: 0,
        },
        bySource: {
            purchase: 0,
            grant: 0,
            migration: 0,
        },
    };
}

function extractAuditNote(metadata: Prisma.JsonValue | null): string | null {
    if (!metadata || typeof metadata !== "object" || Array.isArray(metadata)) {
        return null;
    }

    const record = metadata as Record<string, Prisma.JsonValue>;
    const candidate = record.reason ?? record.note;
    return typeof candidate === "string" && candidate.trim().length > 0 ? candidate : null;
}

function mapRecentOperation(log: {
    id: number;
    action: string;
    summary: string | null;
    createdAt: Date;
    actorRole: string;
    metadata: Prisma.JsonValue | null;
    actor: { username: string } | null;
}): AdminInventoryRecentOperation {
    return {
        id: log.id,
        action: log.action,
        summary: log.summary,
        note: extractAuditNote(log.metadata),
        actorUsername: log.actor?.username ?? null,
        actorRole: log.actorRole,
        createdAt: log.createdAt.toISOString(),
    };
}

export async function searchAdminInventoryUsers(search: string, limit = 12): Promise<AdminInventoryUserOption[]> {
    const normalizedSearch = search.trim();

    const users = await prisma.user.findMany({
        where: normalizedSearch
            ? {
                  OR: [
                      { username: { contains: normalizedSearch } },
                      { email: { contains: normalizedSearch } },
                      {
                          profile: {
                              is: {
                                  displayName: { contains: normalizedSearch },
                              },
                          },
                      },
                  ],
              }
            : {},
        orderBy: [{ createdAt: "desc" }, { id: "desc" }],
        take: limit,
        select: {
            id: true,
            username: true,
            email: true,
            role: true,
            profile: {
                select: {
                    displayName: true,
                },
            },
        },
    });

    return users.map((user) => ({
        id: user.id,
        username: user.username,
        displayName: user.profile?.displayName ?? null,
        email: user.email,
        role: user.role,
    }));
}

export async function getAdminUserInventoryView(userId: number): Promise<AdminUserInventoryView | null> {
    const userExists = await prisma.user.findUnique({
        where: { id: userId },
        select: { id: true },
    });

    if (!userExists) {
        return null;
    }

    const [inventory, recentAuditLogs] = await Promise.all([
        getInventory(userId),
        prisma.auditLog.findMany({
            where: {
                action: {
                    startsWith: "admin.inventory.",
                },
            },
            orderBy: [{ createdAt: "desc" }, { id: "desc" }],
            take: 100,
            select: {
                id: true,
                action: true,
                summary: true,
                createdAt: true,
                actorRole: true,
                metadata: true,
                actor: {
                    select: {
                        username: true,
                    },
                },
            },
        }),
    ]);

    const summary = createEmptySummary();

    for (const item of inventory.items) {
        summary.totalItems += 1;
        summary.byType[item.type] += 1;
        summary.bySource[item.source] += 1;
        if (item.equipped) {
            summary.equippedItems += 1;
        }
    }

    const recentOperations = recentAuditLogs
        .filter((log) => {
            if (!log.metadata || typeof log.metadata !== "object" || Array.isArray(log.metadata)) {
                return false;
            }
            const record = log.metadata as Record<string, Prisma.JsonValue>;
            return record.targetUserId === userId;
        })
        .slice(0, 8)
        .map(mapRecentOperation);

    return {
        id: inventory.id,
        username: inventory.name,
        email: inventory.email,
        role: inventory.role,
        coinBalance: inventory.wallet.coinBalance,
        profile: inventory.profile,
        summary,
        items: inventory.items,
        recentOperations,
    };
}

export async function grantAdminInventoryItem(input: {
    targetUserId: number;
    shopItemId: number;
    reason: string;
}): Promise<AdminInventoryOperationResponse | null | "already_owned"> {
    const result = await prisma.$transaction(async (tx) => {
        const [user, item, existingInventory] = await Promise.all([
            tx.user.findUnique({
                where: { id: input.targetUserId },
                select: {
                    id: true,
                    username: true,
                },
            }),
            tx.shopItem.findUnique({
                where: { id: input.shopItemId },
                select: {
                    id: true,
                    name: true,
                },
            }),
            tx.inventoryItem.findUnique({
                where: {
                    userId_shopItemId: {
                        userId: input.targetUserId,
                        shopItemId: input.shopItemId,
                    },
                },
                select: {
                    id: true,
                },
            }),
        ]);

        if (!user || !item) {
            return null;
        }
        if (existingInventory) {
            return "already_owned" as const;
        }

        await tx.userProfile.upsert({
            where: { userId: input.targetUserId },
            update: {},
            create: { userId: input.targetUserId },
        });

        const inventoryItem = await tx.inventoryItem.create({
            data: {
                userId: input.targetUserId,
                shopItemId: input.shopItemId,
                source: "grant",
            },
        });

        await createUserNotificationWithClient(tx, {
            userId: input.targetUserId,
            type: "system",
            title: "Yeni kozmetik eklendi",
            body: `${item.name} envanterine yönetici tarafından eklendi.`,
            resourceType: "inventory_item",
            resourceId: inventoryItem.id,
            actionLabel: "Envanteri Aç",
            actionHref: "/dashboard?tab=inventory",
            metadata: {
                kind: "admin_inventory_grant",
                reason: input.reason,
                shopItemId: item.id,
            },
        }, { deferCacheInvalidation: true });

        return {
            ok: true as const,
            targetUserId: user.id,
            targetUsername: user.username,
            inventoryItemId: inventoryItem.id,
            shopItemId: item.id,
            shopItemName: item.name,
            inventoryItemSource: "grant" as const,
        };
    });

    if (result && result !== "already_owned") {
        await invalidateNotificationUnreadCountCache(input.targetUserId);
    }
    return result;
}

export async function revokeAdminInventoryItem(input: {
    targetUserId: number;
    inventoryItemId: number;
    reason: string;
    overrideProtectedSource?: boolean;
}): Promise<AdminInventoryOperationResponse | null | "protected_source"> {
    const result = await prisma.$transaction(async (tx) => {
        const inventoryItem = await tx.inventoryItem.findUnique({
            where: { id: input.inventoryItemId },
            include: {
                user: {
                    select: {
                        id: true,
                        username: true,
                    },
                },
                shopItem: {
                    select: {
                        id: true,
                        name: true,
                        type: true,
                    },
                },
            },
        });

        if (!inventoryItem || inventoryItem.userId !== input.targetUserId) {
            return null;
        }
        if (inventoryItem.source !== "grant" && !input.overrideProtectedSource) {
            return "protected_source" as const;
        }

        const profilePatch: Record<string, null> = {};
        const profile = await tx.userProfile.findUnique({
            where: { userId: input.targetUserId },
            select: {
                avatarItemId: true,
                frameItemId: true,
                cardBackItemId: true,
                cardFaceItemId: true,
            },
        });

        if (inventoryItem.shopItem.type === "avatar" && profile?.avatarItemId === inventoryItem.shopItemId) {
            profilePatch.avatarItemId = null;
        }
        if (inventoryItem.shopItem.type === "frame" && profile?.frameItemId === inventoryItem.shopItemId) {
            profilePatch.frameItemId = null;
        }
        if (inventoryItem.shopItem.type === "card_back" && profile?.cardBackItemId === inventoryItem.shopItemId) {
            profilePatch.cardBackItemId = null;
        }
        if (inventoryItem.shopItem.type === "card_face" && profile?.cardFaceItemId === inventoryItem.shopItemId) {
            profilePatch.cardFaceItemId = null;
        }

        if (Object.keys(profilePatch).length > 0) {
            await tx.userProfile.update({
                where: { userId: input.targetUserId },
                data: profilePatch,
            });
        }

        await tx.inventoryItem.delete({
            where: { id: input.inventoryItemId },
        });

        await createUserNotificationWithClient(tx, {
            userId: input.targetUserId,
            type: "system",
            title: "Kozmetik kaldırıldı",
            body: `${inventoryItem.shopItem.name} envanterinden yönetici işlemiyle kaldırıldı.`,
            resourceType: "inventory_item",
            resourceId: input.inventoryItemId,
            metadata: {
                kind: "admin_inventory_revoke",
                reason: input.reason,
                shopItemId: inventoryItem.shopItem.id,
                source: inventoryItem.source,
                overrideProtectedSource: Boolean(input.overrideProtectedSource),
            },
        }, { deferCacheInvalidation: true });

        return {
            ok: true as const,
            targetUserId: inventoryItem.user.id,
            targetUsername: inventoryItem.user.username,
            inventoryItemId: input.inventoryItemId,
            shopItemId: inventoryItem.shopItem.id,
            shopItemName: inventoryItem.shopItem.name,
            inventoryItemSource: inventoryItem.source as "purchase" | "grant" | "migration",
        };
    });

    if (result && result !== "protected_source") {
        await invalidateNotificationUnreadCountCache(input.targetUserId);
    }
    return result;
}

export async function resetAdminInventoryEquipSlot(input: {
    targetUserId: number;
    slot: AdminInventoryEquipSlot;
}): Promise<{
    targetUserId: number;
    targetUsername: string;
    clearedShopItemId: number | null;
    clearedShopItemName: string | null;
    slot: AdminInventoryEquipSlot;
    alreadyEmpty: boolean;
} | null> {
    const slotFieldMap = {
        avatar: "avatarItemId",
        frame: "frameItemId",
        card_back: "cardBackItemId",
        card_face: "cardFaceItemId",
    } as const;

    const result = await prisma.$transaction(async (tx) => {
        const user = await tx.user.findUnique({
            where: { id: input.targetUserId },
            select: {
                id: true,
                username: true,
            },
        });
        if (!user) {
            return null;
        }

        await tx.userProfile.upsert({
            where: { userId: input.targetUserId },
            update: {},
            create: { userId: input.targetUserId },
        });

        const profile = await tx.userProfile.findUnique({
            where: { userId: input.targetUserId },
            select: {
                avatarItemId: true,
                frameItemId: true,
                cardBackItemId: true,
                cardFaceItemId: true,
            },
        });

        const currentItemId =
            input.slot === "avatar"
                ? profile?.avatarItemId ?? null
                : input.slot === "frame"
                  ? profile?.frameItemId ?? null
                  : input.slot === "card_back"
                    ? profile?.cardBackItemId ?? null
                    : profile?.cardFaceItemId ?? null;

        let clearedShopItemName: string | null = null;
        if (currentItemId) {
            const currentItem = await tx.shopItem.findUnique({
                where: { id: currentItemId },
                select: { name: true },
            });
            clearedShopItemName = currentItem?.name ?? null;
        }

        await tx.userProfile.update({
            where: { userId: input.targetUserId },
            data: {
                [slotFieldMap[input.slot]]: null,
            },
        });

        return {
            targetUserId: user.id,
            targetUsername: user.username,
            clearedShopItemId: currentItemId,
            clearedShopItemName,
            slot: input.slot,
            alreadyEmpty: currentItemId === null,
        };
    });

    return result;
}
