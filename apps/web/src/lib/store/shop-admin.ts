import type { StoreItemRarity } from "@/types/economy";

export interface ShopSortUpdate {
    id: number;
    sortOrder: number;
}

export const ADMIN_RARITY_SURFACE_CLASS: Record<StoreItemRarity, string> = {
    common: "border-slate-200/80 bg-slate-50/90 text-slate-700 dark:border-slate-700/70 dark:bg-slate-900/60 dark:text-slate-200",
    rare: "border-sky-200/80 bg-sky-50/90 text-sky-700 dark:border-sky-900/60 dark:bg-sky-950/40 dark:text-sky-300",
    epic: "border-fuchsia-200/80 bg-fuchsia-50/90 text-fuchsia-700 dark:border-fuchsia-900/60 dark:bg-fuchsia-950/35 dark:text-fuchsia-300",
    legendary: "border-amber-200/80 bg-amber-50/90 text-amber-700 dark:border-amber-900/60 dark:bg-amber-950/35 dark:text-amber-300",
};

export const ADMIN_RARITY_BADGE_CLASS: Record<StoreItemRarity, string> = {
    common: "bg-slate-200 text-slate-700 dark:bg-slate-700 dark:text-slate-200",
    rare: "bg-sky-100 text-sky-700 dark:bg-sky-900/40 dark:text-sky-300",
    epic: "bg-fuchsia-100 text-fuchsia-700 dark:bg-fuchsia-900/40 dark:text-fuchsia-300",
    legendary: "bg-amber-100 text-amber-700 dark:bg-amber-900/40 dark:text-amber-300",
};

export const SHOP_RARITY_CARD_CLASS: Record<StoreItemRarity, string> = {
    common: "border-slate-200/80 bg-gradient-to-b from-white/80 to-slate-50/70 dark:border-slate-700/60 dark:from-slate-900/70 dark:to-slate-950/70",
    rare: "border-sky-200/80 bg-gradient-to-b from-sky-50/85 to-white/80 dark:border-sky-900/50 dark:from-sky-950/30 dark:to-slate-950/80",
    epic: "border-fuchsia-200/80 bg-gradient-to-b from-fuchsia-50/85 to-white/80 dark:border-fuchsia-900/50 dark:from-fuchsia-950/30 dark:to-slate-950/80",
    legendary: "border-amber-200/80 bg-gradient-to-b from-amber-50/90 to-orange-50/70 dark:border-amber-900/50 dark:from-amber-950/35 dark:to-slate-950/80",
};

export const SHOP_RARITY_BADGE_CLASS: Record<StoreItemRarity, string> = {
    common: "bg-slate-500/95 text-white",
    rare: "bg-sky-500/95 text-white",
    epic: "bg-fuchsia-600/95 text-white",
    legendary: "bg-amber-500/95 text-slate-950",
};

export const SHOP_RARITY_TOP_STRIP_CLASS: Record<StoreItemRarity, string> = {
    common: "bg-slate-400/80",
    rare: "bg-sky-400/80",
    epic: "bg-fuchsia-500/80",
    legendary: "bg-amber-400/80",
};

export const SHOP_RARITY_HALO_CLASS: Record<StoreItemRarity, string> = {
    common: "",
    rare: "hover:shadow-[0_18px_44px_-28px_rgba(14,165,233,0.5)]",
    epic: "hover:shadow-[0_18px_50px_-26px_rgba(192,38,211,0.48)]",
    legendary: "hover:shadow-[0_20px_56px_-24px_rgba(245,158,11,0.52)]",
};

export const SHOP_RARITY_BUY_BUTTON_CLASS: Record<StoreItemRarity, string> = {
    common: "bg-slate-200 dark:bg-slate-700 text-slate-700 dark:text-slate-200 hover:bg-slate-300 dark:hover:bg-slate-600",
    rare: "bg-sky-600 text-white hover:bg-sky-700 shadow-lg shadow-sky-500/20",
    epic: "bg-fuchsia-600 text-white hover:bg-fuchsia-700 shadow-lg shadow-fuchsia-500/20",
    legendary: "bg-gradient-to-r from-amber-500 to-orange-600 text-white hover:from-amber-600 hover:to-orange-700 shadow-lg shadow-amber-500/30",
};

export function buildShopItemSortUpdates(itemIdsInOrder: number[]): ShopSortUpdate[] {
    return itemIdsInOrder.map((id, index) => ({
        id,
        sortOrder: index * 10,
    }));
}
