import type {
    InventoryItemSource,
    InventoryItemView,
    StoreItemType,
    UserInventoryProfile,
} from "@/types/economy";

export interface AdminInventoryUserOption {
    id: number;
    username: string;
    displayName: string | null;
    email: string | null;
    role: string;
}

export interface AdminInventorySummary {
    totalItems: number;
    equippedItems: number;
    byType: Record<StoreItemType, number>;
    bySource: Record<InventoryItemSource, number>;
}

export interface AdminInventoryRecentOperation {
    id: number;
    action: string;
    summary: string | null;
    note: string | null;
    actorUsername: string | null;
    actorRole: string;
    createdAt: string;
}

export interface AdminUserInventoryView {
    id: number;
    username: string;
    email: string | null;
    role: string;
    coinBalance: number;
    profile: UserInventoryProfile;
    summary: AdminInventorySummary;
    items: InventoryItemView[];
    recentOperations: AdminInventoryRecentOperation[];
}

export interface AdminInventoryOperationResponse {
    ok: true;
    targetUserId: number;
    targetUsername: string;
    inventoryItemId: number | null;
    shopItemId: number;
    shopItemName: string;
    inventoryItemSource: InventoryItemSource;
}

export type AdminInventoryEquipSlot = "avatar" | "frame" | "card_back" | "card_face";
