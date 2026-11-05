import type { StreamCardBack } from "@hushle/domain-streamer";
import { resolveCardBackTheme } from "@/lib/cosmetics/card-back";
import type { StoreItemRarity, StoreItemRenderMode, TemplateConfig } from "@/types/economy";
import { StreamerSessionError } from "./session-runtime";

// Which card backs a streamer may put on the stream screen. The game itself only ever uses
// what a player owns; the stream screen is a showcase, so an owner switch
// (`streamerShowcaseAllCosmetics`) may open the whole store catalogue for it.

export interface CardBackFeatures {
    streamerShowcaseAllCosmetics: boolean;
}

/** The render fields shared by an owned item and a catalogue item. */
interface CardBackRenderFields {
    name: string;
    type: string;
    rarity: StoreItemRarity;
    renderMode: StoreItemRenderMode;
    renderSpecVersion: number;
    imageUrl: string;
    thumbnailUrl: string | null;
    templateKey: string | null;
    templateConfig: TemplateConfig | null;
}

export interface CardBackInventoryItem extends CardBackRenderFields {
    shopItemId: number;
}

export interface CardBackCatalogItem extends CardBackRenderFields {
    id: number;
    isActive: boolean;
}

export interface CardBackInventory {
    profile: { cardBackItemId: number | null };
    items: CardBackInventoryItem[];
}

export interface CardBackLoaders {
    inventory: (userId: number) => Promise<CardBackInventory>;
    catalog: (userId: number) => Promise<CardBackCatalogItem[]>;
}

export interface CardBackOption {
    itemId: number;
    name: string;
    owned: boolean;
    selectable: boolean;
    equipped: boolean;
    preview: {
        renderMode: StoreItemRenderMode;
        imageUrl: string;
        thumbnailUrl: string | null;
        rarity: StoreItemRarity;
    };
}

const defaultLoaders: CardBackLoaders = {
    // Loaded on first use: the database-backed modules stay out of pure callers and tests.
    async inventory(userId) {
        const { getInventory } = await import("@hushle/platform-inventory");
        return getInventory(userId);
    },
    async catalog(userId) {
        const { getStoreCatalog } = await import("@/lib/economy");
        return (await getStoreCatalog(userId)).items;
    },
};

interface Candidate {
    fields: CardBackRenderFields;
    itemId: number;
    owned: boolean;
}

async function candidates(userId: number, features: CardBackFeatures, deps: CardBackLoaders) {
    const inventory = await deps.inventory(userId);
    const byId = new Map<number, Candidate>();
    for (const owned of inventory.items) {
        if (owned.type !== "card_back") continue;
        byId.set(owned.shopItemId, { itemId: owned.shopItemId, fields: owned, owned: true });
    }
    if (features.streamerShowcaseAllCosmetics) {
        for (const entry of await deps.catalog(userId)) {
            if (entry.type !== "card_back" || !entry.isActive || byId.has(entry.id)) continue;
            byId.set(entry.id, { itemId: entry.id, fields: entry, owned: false });
        }
    }
    return { equippedId: inventory.profile.cardBackItemId, list: [...byId.values()] };
}

/** Selectable card backs for a streamer: owned ones always, the active catalogue when the switch is on. */
export async function listCardBacksForUser(
    userId: number,
    features: CardBackFeatures,
    deps: CardBackLoaders = defaultLoaders,
): Promise<CardBackOption[]> {
    const { equippedId, list } = await candidates(userId, features, deps);
    return list
        .map((entry) => ({
            itemId: entry.itemId,
            name: entry.fields.name,
            owned: entry.owned,
            selectable: true,
            equipped: equippedId === entry.itemId,
            preview: {
                renderMode: entry.fields.renderMode,
                imageUrl: entry.fields.imageUrl,
                thumbnailUrl: entry.fields.thumbnailUrl,
                rarity: entry.fields.rarity,
            },
        }))
        .sort((a, b) => a.itemId - b.itemId);
}

/** The chosen card back as the stream screen shows it; `card_not_allowed` when it may not be chosen. */
export async function resolveCardBackSelection(
    userId: number,
    itemId: number,
    features: CardBackFeatures,
    deps: CardBackLoaders = defaultLoaders,
): Promise<StreamCardBack> {
    const { list } = await candidates(userId, features, deps);
    const entry = list.find((candidate) => candidate.itemId === itemId);
    if (!entry) throw new StreamerSessionError("card_not_allowed");
    const fields = entry.fields;
    return {
        itemId: entry.itemId,
        name: fields.name,
        theme: resolveCardBackTheme({
            renderMode: fields.renderMode,
            imageUrl: fields.imageUrl,
            templateKey: fields.templateKey,
            templateConfig: fields.templateConfig,
            rarity: fields.rarity,
            renderSpecVersion: fields.renderSpecVersion,
        }),
        imageUrl: fields.imageUrl || null,
    };
}
