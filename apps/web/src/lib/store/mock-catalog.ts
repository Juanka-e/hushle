import type {
    PromotionDiscountType,
    PromotionTargetType,
    StoreItemRarity,
    StoreItemRenderMode,
    StoreItemType,
    TemplateConfig,
} from "@/types/economy";

export interface MockShopItemSeed {
    code: string;
    type: StoreItemType;
    name: string;
    rarity: StoreItemRarity;
    renderMode: StoreItemRenderMode;
    renderSpecVersion?: number;
    priceCoin: number;
    imageUrl: string;
    thumbnailUrl?: string | null;
    templateKey: string | null;
    templateConfig: TemplateConfig | null;
    badgeText: string | null;
    availabilityMode?: "always_on" | "scheduled" | "seasonal" | "limited" | "event_only";
    startsAt?: string | null;
    endsAt?: string | null;
    isFeatured: boolean;
    isActive: boolean;
    sortOrder: number;
}

export interface MockBundleSeed {
    code: string;
    name: string;
    description: string;
    priceCoin: number;
    isActive: boolean;
    sortOrder: number;
    itemCodes: string[];
}

export interface MockDiscountSeed {
    code: string;
    name: string;
    description: string;
    targetType: PromotionTargetType;
    discountType: PromotionDiscountType;
    percentageOff: number | null;
    fixedCoinOff: number | null;
    targetCode: string | null;
    usageLimit: number | null;
    startsAt: string | null;
    endsAt: string | null;
    isActive: boolean;
    stackableWithCoupon: boolean;
}

export interface MockCouponSeed {
    code: string;
    name: string;
    description: string;
    targetType: PromotionTargetType;
    discountType: PromotionDiscountType;
    percentageOff: number | null;
    fixedCoinOff: number | null;
    targetCode: string | null;
    usageLimit: number | null;
    startsAt: string | null;
    endsAt: string | null;
    isActive: boolean;
}

export const mockShopItems: MockShopItemSeed[] = [
    {
        code: "avatar_pulse_fox",
        type: "avatar",
        name: "Pulse Fox",
        rarity: "common",
        renderMode: "image",
        priceCoin: 120,
        imageUrl: "/cosmetics/mock/avatars/pulse-fox.svg",
        templateKey: null,
        templateConfig: null,
        badgeText: "YENI",
        isFeatured: true,
        isActive: true,
        sortOrder: 10,
    },
    {
        code: "avatar_neon_owl",
        type: "avatar",
        name: "Neon Owl",
        rarity: "rare",
        renderMode: "image",
        priceCoin: 340,
        imageUrl: "/cosmetics/mock/avatars/neon-owl.svg",
        templateKey: null,
        templateConfig: null,
        badgeText: "Spotlight",
        isFeatured: true,
        isActive: true,
        sortOrder: 20,
    },
    {
        code: "frame_royal_ring",
        type: "frame",
        name: "Royal Ring",
        rarity: "epic",
        renderMode: "template",
        priceCoin: 480,
        imageUrl: "",
        templateKey: "royal_ring",
        templateConfig: {
            accentColor: "#c084fc",
        },
        badgeText: null,
        isFeatured: false,
        isActive: true,
        sortOrder: 30,
    },
    {
        code: "frame_arctic_gate",
        type: "frame",
        name: "Arctic Gate",
        rarity: "rare",
        renderMode: "image",
        priceCoin: 520,
        imageUrl: "/cosmetics/mock/frames/arctic-gate.svg",
        templateKey: null,
        templateConfig: null,
        badgeText: "YENI",
        isFeatured: true,
        isActive: true,
        sortOrder: 40,
    },
    {
        code: "card_back_midnight_mesh",
        type: "card_back",
        name: "Midnight Mesh",
        rarity: "rare",
        renderMode: "template",
        priceCoin: 300,
        imageUrl: "",
        templateKey: "midnight_mesh",
        templateConfig: {
            accentColor: "#22d3ee",
        },
        badgeText: null,
        isFeatured: false,
        isActive: true,
        sortOrder: 50,
    },
    {
        code: "card_back_ember_vault",
        type: "card_back",
        name: "Ember Vault",
        rarity: "legendary",
        renderMode: "image",
        priceCoin: 820,
        imageUrl: "/cosmetics/mock/card-backs/ember-vault.svg",
        templateKey: null,
        templateConfig: null,
        badgeText: "LIMITLI",
        isFeatured: true,
        isActive: true,
        sortOrder: 60,
    },
    {
        code: "card_face_signal_grid",
        type: "card_face",
        name: "Signal Grid",
        rarity: "epic",
        renderMode: "template",
        priceCoin: 550,
        imageUrl: "",
        templateKey: "signal_grid",
        templateConfig: {
            borderColor: "#67e8f9",
            texture: "grid",
        },
        badgeText: "YENI",
        isFeatured: true,
        isActive: true,
        sortOrder: 70,
    },
    {
        code: "card_face_ember_glow",
        type: "card_face",
        name: "Ember Glow",
        rarity: "legendary",
        renderMode: "image",
        priceCoin: 960,
        imageUrl: "/cosmetics/mock/card-faces/ember-glow.svg",
        templateKey: null,
        templateConfig: null,
        badgeText: "PREMIUM",
        isFeatured: true,
        isActive: true,
        sortOrder: 80,
    },
];

export const mockBundles: MockBundleSeed[] = [
    {
        code: "bundle_starter_showcase",
        name: "Starter Showcase",
        description: "Avatar, frame ve kart arkasi ile ilk set.",
        priceCoin: 780,
        isActive: true,
        sortOrder: 10,
        itemCodes: [
            "avatar_pulse_fox",
            "frame_royal_ring",
            "card_back_midnight_mesh",
        ],
    },
    {
        code: "bundle_legends_cache",
        name: "Legends Cache",
        description: "Nadir avatar, premium frame ve iki kart temasi.",
        priceCoin: 2200,
        isActive: true,
        sortOrder: 20,
        itemCodes: [
            "avatar_neon_owl",
            "frame_arctic_gate",
            "card_back_ember_vault",
            "card_face_ember_glow",
        ],
    },
];

export const mockDiscountCampaigns: MockDiscountSeed[] = [
    {
        code: "discount_launch_bundle",
        name: "Launch Bundle Week",
        description: "Starter Showcase paketinde acilis indirimi.",
        targetType: "bundle",
        discountType: "percentage",
        percentageOff: 15,
        fixedCoinOff: null,
        targetCode: "bundle_starter_showcase",
        usageLimit: 250,
        startsAt: "2026-03-09T00:00:00.000Z",
        endsAt: "2026-03-23T00:00:00.000Z",
        isActive: true,
        stackableWithCoupon: false,
    },
    {
        code: "discount_neon_owl_spotlight",
        name: "Neon Owl Spotlight",
        description: "Neon Owl avatarinda sabit coin indirimi.",
        targetType: "shop_item",
        discountType: "fixed_coin",
        percentageOff: null,
        fixedCoinOff: 60,
        targetCode: "avatar_neon_owl",
        usageLimit: 120,
        startsAt: "2026-03-09T00:00:00.000Z",
        endsAt: "2026-03-16T00:00:00.000Z",
        isActive: true,
        stackableWithCoupon: true,
    },
];

export const mockCouponCodes: MockCouponSeed[] = [
    {
        code: "WELCOME25",
        name: "Welcome 25",
        description: "Ilk satin almada global coin indirimi.",
        targetType: "global",
        discountType: "fixed_coin",
        percentageOff: null,
        fixedCoinOff: 25,
        targetCode: null,
        usageLimit: 500,
        startsAt: "2026-03-09T00:00:00.000Z",
        endsAt: "2026-04-09T00:00:00.000Z",
        isActive: true,
    },
    {
        code: "LEGENDS15",
        name: "Legends 15",
        description: "Legends Cache paketi icin yuzde indirim.",
        targetType: "bundle",
        discountType: "percentage",
        percentageOff: 15,
        fixedCoinOff: null,
        targetCode: "bundle_legends_cache",
        usageLimit: 120,
        startsAt: "2026-03-09T00:00:00.000Z",
        endsAt: "2026-03-30T00:00:00.000Z",
        isActive: true,
    },
];
