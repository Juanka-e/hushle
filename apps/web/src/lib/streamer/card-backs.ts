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
    /** ISO instants of the availability window; null means open on that side. */
    startsAt: string | null;
    endsAt: string | null;
}

export interface CardBackInventory {
    profile: { cardBackItemId: number | null };
    items: CardBackInventoryItem[];
}

export interface CardBackLoaders {
    inventory: (userId: number) => Promise<CardBackInventory>;
    catalog: (userId: number) => Promise<CardBackCatalogItem[]>;
    /** The loaders' own clock; a clock passed to the call wins over it. */
    now?: () => number;
}

/** The time the availability window is judged at: the caller's clock first, then the loaders', then the wall clock. */
function timeOf(deps: CardBackLoaders, now?: () => number): number {
    if (now) return now();
    return deps.now ? deps.now() : Date.now();
}

export interface CardBackOption {
    itemId: number;
    name: string;
    owned: boolean;
    /** Always true in this phase: only selectable card backs are listed. */
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

// The platform catalogue only filters `isActive` in the database; the availability window is
// the caller's to check, so a scheduled or ended item is not offered even with the switch on.
// It fails closed: a bound that is set but does not parse makes the item unavailable.
function inWindow(entry: CardBackCatalogItem, now: number): boolean {
    const starts = entry.startsAt === null || entry.startsAt === undefined ? null : Date.parse(entry.startsAt);
    const ends = entry.endsAt === null || entry.endsAt === undefined ? null : Date.parse(entry.endsAt);
    if (Number.isNaN(starts) || Number.isNaN(ends)) return false;
    return (starts === null || starts <= now) && (ends === null || ends >= now);
}

function selectableFromCatalogue(entry: CardBackCatalogItem, now: number): boolean {
    return entry.type === "card_back" && entry.isActive && inWindow(entry, now);
}

async function load<T>(task: () => Promise<T>): Promise<T> {
    try {
        return await task();
    } catch {
        throw new StreamerSessionError("card_catalogue_unavailable");
    }
}

async function candidates(userId: number, features: CardBackFeatures, deps: CardBackLoaders, clock?: () => number) {
    const inventory = await load(() => deps.inventory(userId));
    const catalog = features.streamerShowcaseAllCosmetics ? await load(() => deps.catalog(userId)) : [];
    const now = timeOf(deps, clock);
    const byId = new Map<number, Candidate>();
    for (const owned of inventory.items) {
        if (owned.type !== "card_back") continue;
        byId.set(owned.shopItemId, { itemId: owned.shopItemId, fields: owned, owned: true });
    }
    for (const entry of catalog) {
        if (!selectableFromCatalogue(entry, now) || byId.has(entry.id)) continue;
        byId.set(entry.id, { itemId: entry.id, fields: entry, owned: false });
    }
    return { equippedId: inventory.profile.cardBackItemId, list: [...byId.values()] };
}

/**
 * Selectable card backs for a streamer: owned ones always, the active catalogue when the switch
 * is on. `now` is the caller's clock for the availability window.
 */
export async function listCardBacksForUser(
    userId: number,
    features: CardBackFeatures,
    deps: CardBackLoaders = defaultLoaders,
    now?: () => number,
): Promise<CardBackOption[]> {
    const { equippedId, list } = await candidates(userId, features, deps, now);
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

function toStreamCardBack(itemId: number, fields: CardBackRenderFields): StreamCardBack {
    return {
        itemId,
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

/**
 * The chosen card back as the stream screen shows it; `card_not_allowed` when it may not be
 * chosen. `now` is the caller's clock for the availability window (the session service passes
 * its own, so both judge time alike).
 */
export async function resolveCardBackSelection(
    userId: number,
    itemId: number,
    features: CardBackFeatures,
    deps: CardBackLoaders = defaultLoaders,
    now?: () => number,
): Promise<StreamCardBack> {
    const inventory = await load(() => deps.inventory(userId));
    // An owned card back is drawn from the inventory entry alone: it carries every render field
    // the stream screen needs (name, image, render mode, template, rarity, render spec), as the
    // render snapshot the player bought. The catalogue is read only for an item not owned.
    const owned = inventory.items.find((entry) => entry.type === "card_back" && entry.shopItemId === itemId);
    if (owned) return toStreamCardBack(itemId, owned);
    if (!features.streamerShowcaseAllCosmetics) throw new StreamerSessionError("card_not_allowed");
    const catalog = await load(() => deps.catalog(userId));
    const at = timeOf(deps, now);
    const entry = catalog.find((candidate) => candidate.id === itemId && selectableFromCatalogue(candidate, at));
    if (!entry) throw new StreamerSessionError("card_not_allowed");
    return toStreamCardBack(itemId, entry);
}
