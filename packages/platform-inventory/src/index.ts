import { Prisma, prisma } from "@hushle/platform-db";
import { z } from "zod";

export const INVENTORY_ITEM_TYPES = [
    "avatar",
    "frame",
    "card_back",
    "card_face",
] as const;

export type InventoryItemType = (typeof INVENTORY_ITEM_TYPES)[number];
export type TemplateConfigScalar = string | number | boolean | null;
export type TemplateConfigValue =
    | TemplateConfigScalar
    | TemplateConfigScalar[]
    | { [key: string]: TemplateConfigValue };
export type TemplateConfig = { [key: string]: TemplateConfigValue };

export type EquippedSlots = {
    avatarItemId: number | null;
    frameItemId: number | null;
    cardBackItemId: number | null;
    cardFaceItemId: number | null;
};

export type InventoryItemView = {
    inventoryItemId: number;
    shopItemId: number;
    code: string;
    name: string;
    type: InventoryItemType;
    rarity: "common" | "rare" | "epic" | "legendary";
    renderMode: "image" | "template";
    renderSpecVersion: number;
    priceCoin: number;
    imageUrl: string;
    thumbnailUrl: string | null;
    templateKey: string | null;
    templateConfig: TemplateConfig | null;
    badgeText: string | null;
    availabilityMode:
        | "always_on"
        | "scheduled"
        | "seasonal"
        | "limited"
        | "event_only";
    startsAt: string | null;
    endsAt: string | null;
    isFeatured: boolean;
    source: "purchase" | "grant" | "migration";
    acquiredAt: string;
    equipped: boolean;
};

export type InventoryProfileView = EquippedSlots & {
    displayName: string | null;
    bio: string | null;
};

export type InventoryView = {
    id: number;
    name: string;
    email: string | null;
    emailVerifiedAt: string | null;
    role: string;
    wallet: { coinBalance: number };
    profile: InventoryProfileView;
    items: InventoryItemView[];
};

export type InventoryPageView = {
    profile: InventoryProfileView;
    items: InventoryItemView[];
    page: {
        nextCursor: string | null;
        hasMore: boolean;
        limit: number;
    };
};

const inventoryQuerySchema = z.object({
    cursor: z.string().trim().min(1).max(256).optional(),
    limit: z.coerce.number().int().min(1).max(50).default(25),
    type: z.enum(INVENTORY_ITEM_TYPES).optional(),
});

const equipSchema = z.object({
    shopItemId: z.number().int().positive().nullable(),
    itemType: z.enum(INVENTORY_ITEM_TYPES),
});

type InventoryCursor = { acquiredAt: Date; id: number };

export class InventoryError extends Error {
    constructor(
        public readonly code:
            | "invalid_request"
            | "invalid_cursor"
            | "user_not_found"
            | "item_not_found"
            | "not_owned"
            | "type_mismatch",
        message: string = code
    ) {
        super(message);
        this.name = "InventoryError";
    }
}

function normalizeRenderSpecVersion(value: number | null | undefined): number {
    return Number.isInteger(value) && Number(value) > 0 ? Number(value) : 1;
}

const MAX_TEMPLATE_DEPTH = 3;
const MAX_TEMPLATE_KEYS = 24;
const MAX_TEMPLATE_ARRAY = 12;

function normalizeTemplateNode(
    value: unknown,
    depth: number
): TemplateConfigValue | undefined {
    if (
        value === null ||
        typeof value === "string" ||
        typeof value === "boolean" ||
        (typeof value === "number" && Number.isFinite(value))
    ) {
        return value;
    }
    if (
        Array.isArray(value) &&
        value.length <= MAX_TEMPLATE_ARRAY &&
        value.every(
            (entry) =>
                entry === null ||
                typeof entry === "string" ||
                typeof entry === "boolean" ||
                (typeof entry === "number" && Number.isFinite(entry))
        )
    ) {
        return value as TemplateConfigScalar[];
    }
    if (
        !value ||
        typeof value !== "object" ||
        Array.isArray(value) ||
        depth >= MAX_TEMPLATE_DEPTH
    ) {
        return undefined;
    }
    const entries = Object.entries(value);
    if (entries.length === 0 || entries.length > MAX_TEMPLATE_KEYS) {
        return undefined;
    }
    const normalized: [string, TemplateConfigValue][] = [];
    for (const [key, entry] of entries) {
        if (!key || key.length > 80) continue;
        const child = normalizeTemplateNode(entry, depth + 1);
        if (child !== undefined) normalized.push([key, child]);
    }
    return normalized.length > 0 ? Object.fromEntries(normalized) : undefined;
}

export function normalizeTemplateConfig(value: unknown): TemplateConfig | null {
    const normalized = normalizeTemplateNode(value, 0);
    return normalized && typeof normalized === "object" && !Array.isArray(normalized)
        ? (normalized as TemplateConfig)
        : null;
}

type RenderSnapshot = {
    type: InventoryItemType;
    rarity: InventoryItemView["rarity"];
    renderMode: InventoryItemView["renderMode"];
    renderSpecVersion: number;
    imageUrl: string;
    templateKey: string | null;
    templateConfig: TemplateConfig | null;
    badgeText: string | null;
};

function readRenderSnapshot(value: Prisma.JsonValue | null): RenderSnapshot | null {
    if (!value || typeof value !== "object" || Array.isArray(value)) return null;
    const candidate = value as Record<string, unknown>;
    if (
        !INVENTORY_ITEM_TYPES.includes(candidate.type as InventoryItemType) ||
        !["common", "rare", "epic", "legendary"].includes(
            String(candidate.rarity)
        ) ||
        !["image", "template"].includes(String(candidate.renderMode)) ||
        typeof candidate.imageUrl !== "string"
    ) {
        return null;
    }
    return {
        type: candidate.type as InventoryItemType,
        rarity: candidate.rarity as RenderSnapshot["rarity"],
        renderMode: candidate.renderMode as RenderSnapshot["renderMode"],
        renderSpecVersion: normalizeRenderSpecVersion(
            typeof candidate.renderSpecVersion === "number"
                ? candidate.renderSpecVersion
                : null
        ),
        imageUrl: candidate.imageUrl,
        templateKey:
            typeof candidate.templateKey === "string"
                ? candidate.templateKey
                : null,
        templateConfig: normalizeTemplateConfig(candidate.templateConfig),
        badgeText:
            typeof candidate.badgeText === "string"
                ? candidate.badgeText
                : null,
    };
}

function getEquippedSlots(profile: EquippedSlots | null): EquippedSlots {
    return {
        avatarItemId: profile?.avatarItemId ?? null,
        frameItemId: profile?.frameItemId ?? null,
        cardBackItemId: profile?.cardBackItemId ?? null,
        cardFaceItemId: profile?.cardFaceItemId ?? null,
    };
}

function isEquipped(
    shopItemId: number,
    type: InventoryItemType,
    slots: EquippedSlots
): boolean {
    if (type === "avatar") return slots.avatarItemId === shopItemId;
    if (type === "frame") return slots.frameItemId === shopItemId;
    if (type === "card_back") return slots.cardBackItemId === shopItemId;
    return slots.cardFaceItemId === shopItemId;
}

const inventoryInclude = {
    shopItem: true,
} satisfies Prisma.InventoryItemInclude;

type InventoryRecord = Prisma.InventoryItemGetPayload<{
    include: typeof inventoryInclude;
}>;

function mapInventoryItem(
    entry: InventoryRecord,
    slots: EquippedSlots
): InventoryItemView {
    const snapshot = readRenderSnapshot(entry.renderSnapshot);
    return {
        inventoryItemId: entry.id,
        shopItemId: entry.shopItemId,
        code: entry.shopItem.code,
        name: entry.shopItem.name,
        type: snapshot?.type ?? entry.shopItem.type,
        rarity: snapshot?.rarity ?? entry.shopItem.rarity,
        renderMode: snapshot?.renderMode ?? entry.shopItem.renderMode,
        renderSpecVersion:
            snapshot?.renderSpecVersion ??
            normalizeRenderSpecVersion(entry.shopItem.renderSpecVersion),
        priceCoin: entry.shopItem.priceCoin,
        imageUrl: snapshot?.imageUrl ?? entry.shopItem.imageUrl,
        thumbnailUrl: entry.shopItem.thumbnailUrl,
        templateKey: snapshot?.templateKey ?? entry.shopItem.templateKey,
        templateConfig:
            snapshot?.templateConfig ??
            normalizeTemplateConfig(entry.shopItem.templateConfig),
        badgeText: snapshot?.badgeText ?? entry.shopItem.badgeText,
        availabilityMode: entry.shopItem.availabilityMode,
        startsAt: entry.shopItem.startsAt?.toISOString() ?? null,
        endsAt: entry.shopItem.endsAt?.toISOString() ?? null,
        isFeatured: entry.shopItem.isFeatured,
        source: entry.source,
        acquiredAt: entry.acquiredAt.toISOString(),
        equipped: isEquipped(entry.shopItemId, entry.shopItem.type, slots),
    };
}

async function ensureInventoryProfile(userId: number): Promise<void> {
    const exists = await prisma.user.findUnique({
        where: { id: userId },
        select: { id: true },
    });
    if (!exists) throw new InventoryError("user_not_found");
    await prisma.userProfile.upsert({
        where: { userId },
        update: {},
        create: { userId },
    });
}

function decodeCursor(value: string): InventoryCursor {
    try {
        const decoded = JSON.parse(
            Buffer.from(value, "base64url").toString("utf8")
        ) as { acquiredAt?: unknown; id?: unknown };
        const acquiredAt = new Date(String(decoded.acquiredAt ?? ""));
        if (
            !Number.isFinite(acquiredAt.getTime()) ||
            !Number.isInteger(decoded.id) ||
            Number(decoded.id) <= 0
        ) {
            throw new Error("invalid");
        }
        return { acquiredAt, id: Number(decoded.id) };
    } catch {
        throw new InventoryError("invalid_cursor");
    }
}

function encodeCursor(entry: { acquiredAt: Date; id: number }): string {
    return Buffer.from(
        JSON.stringify({
            acquiredAt: entry.acquiredAt.toISOString(),
            id: entry.id,
        })
    ).toString("base64url");
}

export function parseInventoryQuery(input: unknown): {
    cursor?: string;
    limit: number;
    type?: InventoryItemType;
} {
    const parsed = inventoryQuerySchema.safeParse(input);
    if (!parsed.success) {
        throw new InventoryError(
            "invalid_request",
            parsed.error.issues[0]?.message
        );
    }
    return parsed.data;
}

export function parseEquipRequest(input: unknown): {
    shopItemId: number | null;
    itemType: InventoryItemType;
} {
    const parsed = equipSchema.safeParse(input);
    if (!parsed.success) {
        throw new InventoryError(
            "invalid_request",
            parsed.error.issues[0]?.message
        );
    }
    return parsed.data;
}

async function loadProfile(userId: number): Promise<InventoryProfileView> {
    const profile = await prisma.userProfile.findUnique({
        where: { userId },
        select: {
            displayName: true,
            bio: true,
            avatarItemId: true,
            frameItemId: true,
            cardBackItemId: true,
            cardFaceItemId: true,
        },
    });
    const slots = getEquippedSlots(profile);
    return {
        displayName: profile?.displayName ?? null,
        bio: profile?.bio ?? null,
        ...slots,
    };
}

export async function getInventoryPage(input: {
    userId: number;
    query?: unknown;
}): Promise<InventoryPageView> {
    const query = parseInventoryQuery(input.query ?? {});
    const cursor = query.cursor ? decodeCursor(query.cursor) : null;
    const [user, profile, rows] = await Promise.all([
        prisma.user.findUnique({
            where: { id: input.userId },
            select: { id: true },
        }),
        loadProfile(input.userId),
        prisma.inventoryItem.findMany({
            where: {
                userId: input.userId,
                ...(query.type ? { shopItem: { type: query.type } } : {}),
                ...(cursor
                    ? {
                          OR: [
                              { acquiredAt: { lt: cursor.acquiredAt } },
                              {
                                  acquiredAt: cursor.acquiredAt,
                                  id: { lt: cursor.id },
                              },
                          ],
                      }
                    : {}),
            },
            include: inventoryInclude,
            orderBy: [{ acquiredAt: "desc" }, { id: "desc" }],
            take: query.limit + 1,
        }),
    ]);
    if (!user) throw new InventoryError("user_not_found");
    const hasMore = rows.length > query.limit;
    const visibleRows = hasMore ? rows.slice(0, query.limit) : rows;
    const last = visibleRows.at(-1);
    return {
        profile,
        items: visibleRows.map((entry) => mapInventoryItem(entry, profile)),
        page: {
            nextCursor: hasMore && last ? encodeCursor(last) : null,
            hasMore,
            limit: query.limit,
        },
    };
}

export async function getInventory(userId: number): Promise<InventoryView> {
    const [user, profile, inventory] = await Promise.all([
        prisma.user.findUnique({
            where: { id: userId },
            select: {
                id: true,
                username: true,
                email: true,
                emailVerifiedAt: true,
                role: true,
                wallet: { select: { coinBalance: true } },
            },
        }),
        loadProfile(userId),
        prisma.inventoryItem.findMany({
            where: { userId },
            include: inventoryInclude,
            orderBy: [{ acquiredAt: "desc" }, { id: "desc" }],
        }),
    ]);
    if (!user) throw new InventoryError("user_not_found");
    return {
        id: user.id,
        name: user.username,
        email: user.email,
        emailVerifiedAt: user.emailVerifiedAt?.toISOString() ?? null,
        role: user.role,
        wallet: { coinBalance: user.wallet?.coinBalance ?? 0 },
        profile,
        items: inventory.map((entry) => mapInventoryItem(entry, profile)),
    };
}

export async function equipInventoryItem(input: {
    userId: number;
    request: unknown;
}): Promise<{ profile: InventoryProfileView; equippedSlots: EquippedSlots }> {
    const request = parseEquipRequest(input.request);
    await ensureInventoryProfile(input.userId);
    const data: Record<string, number | null> = {
        [request.itemType === "avatar"
            ? "avatarItemId"
            : request.itemType === "frame"
              ? "frameItemId"
              : request.itemType === "card_back"
                ? "cardBackItemId"
                : "cardFaceItemId"]: null,
    };

    const profile = await prisma.$transaction(
        async (tx) => {
            if (request.shopItemId !== null) {
                const item = await tx.shopItem.findUnique({
                    where: { id: request.shopItemId },
                    select: { id: true, type: true },
                });
                if (!item) throw new InventoryError("item_not_found");
                if (item.type !== request.itemType) {
                    throw new InventoryError("type_mismatch");
                }
                const owned = await tx.inventoryItem.findUnique({
                    where: {
                        userId_shopItemId: {
                            userId: input.userId,
                            shopItemId: request.shopItemId,
                        },
                    },
                    select: { id: true },
                });
                if (!owned) throw new InventoryError("not_owned");
                data[Object.keys(data)[0]!] = item.id;
            }

            return tx.userProfile.update({
                where: { userId: input.userId },
                data,
                select: {
                    displayName: true,
                    bio: true,
                    avatarItemId: true,
                    frameItemId: true,
                    cardBackItemId: true,
                    cardFaceItemId: true,
                },
            });
        },
        { isolationLevel: Prisma.TransactionIsolationLevel.Serializable }
    );
    const slots = getEquippedSlots(profile);
    return {
        profile: {
            displayName: profile.displayName,
            bio: profile.bio,
            ...slots,
        },
        equippedSlots: slots,
    };
}
