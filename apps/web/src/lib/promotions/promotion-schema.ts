import {
    Prisma,
    PromotionDiscountType as PrismaPromotionDiscountType,
    PromotionTargetType as PrismaPromotionTargetType,
} from "@hushle/platform-db";
import { z } from "zod";
import {
    PROMOTION_DISCOUNT_TYPES,
    PROMOTION_TARGET_TYPES,
    type PromotionDiscountType,
    type PromotionTargetType,
} from "@/types/economy";

const codeSchema = z
    .string()
    .trim()
    .min(1)
    .max(80)
    .regex(/^[a-z0-9_-]+$/i, "Code can only contain letters, numbers, dash and underscore.");

const optionalTextSchema = z.string().trim().max(300).optional().nullable();
const optionalDateSchema = z
    .string()
    .trim()
    .datetime({ offset: true })
    .optional()
    .nullable();
const optionalForeignKeySchema = z.number().int().positive().optional().nullable();

const promotionBaseSchema = z.object({
    code: codeSchema,
    name: z.string().trim().min(1).max(120),
    description: optionalTextSchema,
    targetType: z.enum(PROMOTION_TARGET_TYPES),
    discountType: z.enum(PROMOTION_DISCOUNT_TYPES),
    percentageOff: z.number().int().min(1).max(100).optional().nullable(),
    fixedCoinOff: z.number().int().min(1).max(1_000_000).optional().nullable(),
    shopItemId: optionalForeignKeySchema,
    bundleId: optionalForeignKeySchema,
    usageLimit: z.number().int().min(1).max(1_000_000).optional().nullable(),
    startsAt: optionalDateSchema,
    endsAt: optionalDateSchema,
    isActive: z.boolean().default(true),
});

const bundleItemSchema = z.object({
    shopItemId: z.number().int().positive(),
    sortOrder: z.number().int().min(0).max(10_000).default(0),
});

const bundleBaseSchema = z.object({
    code: codeSchema,
    name: z.string().trim().min(1).max(120),
    description: optionalTextSchema,
    priceCoin: z.number().int().min(0).max(1_000_000),
    isActive: z.boolean().default(true),
    sortOrder: z.number().int().min(0).max(10_000).default(0),
    items: z.array(bundleItemSchema).min(1).max(24),
});

function validatePromotionTarget(
    value: {
        targetType?: PromotionTargetType;
        shopItemId?: number | null;
        bundleId?: number | null;
    },
    context: z.RefinementCtx
) {
    if (value.targetType === "global") {
        if (value.shopItemId || value.bundleId) {
            context.addIssue({
                code: z.ZodIssueCode.custom,
                path: ["targetType"],
                message: "Global promotions cannot target a shop item or bundle.",
            });
        }
        return;
    }

    if (value.targetType === "shop_item") {
        if (!value.shopItemId || value.bundleId) {
            context.addIssue({
                code: z.ZodIssueCode.custom,
                path: ["shopItemId"],
                message: "Shop-item promotions require only shopItemId.",
            });
        }
        return;
    }

    if (!value.bundleId || value.shopItemId) {
        context.addIssue({
            code: z.ZodIssueCode.custom,
            path: ["bundleId"],
            message: "Bundle promotions require only bundleId.",
        });
    }
}

function validateDiscountShape(
    value: {
        discountType?: PromotionDiscountType;
        percentageOff?: number | null;
        fixedCoinOff?: number | null;
    },
    context: z.RefinementCtx
) {
    if (value.discountType === "percentage") {
        if (!value.percentageOff || value.fixedCoinOff) {
            context.addIssue({
                code: z.ZodIssueCode.custom,
                path: ["percentageOff"],
                message: "Percentage promotions require percentageOff only.",
            });
        }
        return;
    }

    if (!value.fixedCoinOff || value.percentageOff) {
        context.addIssue({
            code: z.ZodIssueCode.custom,
            path: ["fixedCoinOff"],
            message: "Fixed-coin promotions require fixedCoinOff only.",
        });
    }
}

function validateDateWindow(
    value: {
        startsAt?: string | null;
        endsAt?: string | null;
    },
    context: z.RefinementCtx
) {
    if (!value.startsAt || !value.endsAt) {
        return;
    }

    if (new Date(value.endsAt).getTime() <= new Date(value.startsAt).getTime()) {
        context.addIssue({
            code: z.ZodIssueCode.custom,
            path: ["endsAt"],
            message: "endsAt must be later than startsAt.",
        });
    }
}

function validateBundleItems(
    items: Array<{ shopItemId: number; sortOrder: number }>,
    context: z.RefinementCtx
) {
    const seen = new Set<number>();
    for (const [index, item] of items.entries()) {
        if (seen.has(item.shopItemId)) {
            context.addIssue({
                code: z.ZodIssueCode.custom,
                path: ["items", index, "shopItemId"],
                message: "Bundle items must be unique.",
            });
            return;
        }
        seen.add(item.shopItemId);
    }
}

export const bundleWriteSchema = bundleBaseSchema.superRefine((value, context) => {
    validateBundleItems(value.items, context);
});

export const bundleUpdateSchema = bundleBaseSchema.partial().superRefine((value, context) => {
    if (value.items) {
        validateBundleItems(value.items, context);
    }
});

export const discountCampaignWriteSchema = promotionBaseSchema.extend({
    stackableWithCoupon: z.boolean().default(false),
}).superRefine((value, context) => {
    validatePromotionTarget(value, context);
    validateDiscountShape(value, context);
    validateDateWindow(value, context);
});

export const discountCampaignUpdateSchema = promotionBaseSchema.partial().extend({
    stackableWithCoupon: z.boolean().optional(),
}).superRefine((value, context) => {
    if (value.targetType) {
        validatePromotionTarget(value, context);
    }
    if (value.discountType) {
        validateDiscountShape(value, context);
    }
    validateDateWindow(value, context);
});

export const couponCodeWriteSchema = promotionBaseSchema.superRefine((value, context) => {
    validatePromotionTarget(value, context);
    validateDiscountShape(value, context);
    validateDateWindow(value, context);
});

export const couponCodeUpdateSchema = promotionBaseSchema.partial().superRefine((value, context) => {
    if (value.targetType) {
        validatePromotionTarget(value, context);
    }
    if (value.discountType) {
        validateDiscountShape(value, context);
    }
    validateDateWindow(value, context);
});

export type BundleWriteInput = z.infer<typeof bundleWriteSchema>;
export type BundleUpdateInput = z.infer<typeof bundleUpdateSchema>;
export type DiscountCampaignWriteInput = z.infer<typeof discountCampaignWriteSchema>;
export type DiscountCampaignUpdateInput = z.infer<typeof discountCampaignUpdateSchema>;
export type CouponCodeWriteInput = z.infer<typeof couponCodeWriteSchema>;
export type CouponCodeUpdateInput = z.infer<typeof couponCodeUpdateSchema>;

const PRISMA_PROMOTION_TARGET_TYPE_MAP: Record<PromotionTargetType, PrismaPromotionTargetType> = {
    global: PrismaPromotionTargetType.global,
    shop_item: PrismaPromotionTargetType.shop_item,
    bundle: PrismaPromotionTargetType.bundle,
};

const PRISMA_PROMOTION_DISCOUNT_TYPE_MAP: Record<PromotionDiscountType, PrismaPromotionDiscountType> = {
    percentage: PrismaPromotionDiscountType.percentage,
    fixed_coin: PrismaPromotionDiscountType.fixed_coin,
};

function parseDateOrNull(value: string | null | undefined): Date | null {
    return value ? new Date(value) : null;
}

export function toPrismaBundleCreateData(input: BundleWriteInput): Prisma.ShopBundleCreateInput {
    return {
        code: input.code,
        name: input.name,
        description: input.description ?? null,
        priceCoin: input.priceCoin,
        isActive: input.isActive,
        sortOrder: input.sortOrder,
        items: {
            create: input.items.map((item) => ({
                sortOrder: item.sortOrder,
                shopItem: {
                    connect: { id: item.shopItemId },
                },
            })),
        },
    };
}

export function toPrismaBundleUpdateData(input: BundleUpdateInput): Prisma.ShopBundleUpdateInput {
    return {
        ...(input.code !== undefined ? { code: input.code } : {}),
        ...(input.name !== undefined ? { name: input.name } : {}),
        ...(input.description !== undefined ? { description: input.description ?? null } : {}),
        ...(input.priceCoin !== undefined ? { priceCoin: input.priceCoin } : {}),
        ...(input.isActive !== undefined ? { isActive: input.isActive } : {}),
        ...(input.sortOrder !== undefined ? { sortOrder: input.sortOrder } : {}),
    };
}

export function toPrismaDiscountCampaignCreateData(
    input: DiscountCampaignWriteInput
): Prisma.DiscountCampaignCreateInput {
    return {
        code: input.code,
        name: input.name,
        description: input.description ?? null,
        targetType: PRISMA_PROMOTION_TARGET_TYPE_MAP[input.targetType],
        discountType: PRISMA_PROMOTION_DISCOUNT_TYPE_MAP[input.discountType],
        percentageOff: input.percentageOff ?? null,
        fixedCoinOff: input.fixedCoinOff ?? null,
        usageLimit: input.usageLimit ?? null,
        startsAt: parseDateOrNull(input.startsAt),
        endsAt: parseDateOrNull(input.endsAt),
        isActive: input.isActive,
        stackableWithCoupon: input.stackableWithCoupon,
        ...(input.shopItemId ? { shopItem: { connect: { id: input.shopItemId } } } : {}),
        ...(input.bundleId ? { bundle: { connect: { id: input.bundleId } } } : {}),
    };
}

export function toPrismaDiscountCampaignUpdateData(
    input: DiscountCampaignUpdateInput
): Prisma.DiscountCampaignUpdateInput {
    return {
        ...(input.code !== undefined ? { code: input.code } : {}),
        ...(input.name !== undefined ? { name: input.name } : {}),
        ...(input.description !== undefined ? { description: input.description ?? null } : {}),
        ...(input.targetType !== undefined
            ? { targetType: PRISMA_PROMOTION_TARGET_TYPE_MAP[input.targetType] }
            : {}),
        ...(input.discountType !== undefined
            ? { discountType: PRISMA_PROMOTION_DISCOUNT_TYPE_MAP[input.discountType] }
            : {}),
        ...(input.percentageOff !== undefined ? { percentageOff: input.percentageOff ?? null } : {}),
        ...(input.fixedCoinOff !== undefined ? { fixedCoinOff: input.fixedCoinOff ?? null } : {}),
        ...(input.usageLimit !== undefined ? { usageLimit: input.usageLimit ?? null } : {}),
        ...(input.startsAt !== undefined ? { startsAt: parseDateOrNull(input.startsAt) } : {}),
        ...(input.endsAt !== undefined ? { endsAt: parseDateOrNull(input.endsAt) } : {}),
        ...(input.isActive !== undefined ? { isActive: input.isActive } : {}),
        ...(input.stackableWithCoupon !== undefined ? { stackableWithCoupon: input.stackableWithCoupon } : {}),
        ...(input.shopItemId !== undefined
            ? {
                shopItem: input.shopItemId
                    ? { connect: { id: input.shopItemId } }
                    : { disconnect: true },
            }
            : {}),
        ...(input.bundleId !== undefined
            ? {
                bundle: input.bundleId
                    ? { connect: { id: input.bundleId } }
                    : { disconnect: true },
            }
            : {}),
    };
}

export function toPrismaCouponCodeCreateData(input: CouponCodeWriteInput): Prisma.CouponCodeCreateInput {
    return {
        code: input.code,
        name: input.name,
        description: input.description ?? null,
        targetType: PRISMA_PROMOTION_TARGET_TYPE_MAP[input.targetType],
        discountType: PRISMA_PROMOTION_DISCOUNT_TYPE_MAP[input.discountType],
        percentageOff: input.percentageOff ?? null,
        fixedCoinOff: input.fixedCoinOff ?? null,
        usageLimit: input.usageLimit ?? null,
        startsAt: parseDateOrNull(input.startsAt),
        endsAt: parseDateOrNull(input.endsAt),
        isActive: input.isActive,
        ...(input.shopItemId ? { shopItem: { connect: { id: input.shopItemId } } } : {}),
        ...(input.bundleId ? { bundle: { connect: { id: input.bundleId } } } : {}),
    };
}

export function toPrismaCouponCodeUpdateData(input: CouponCodeUpdateInput): Prisma.CouponCodeUpdateInput {
    return {
        ...(input.code !== undefined ? { code: input.code } : {}),
        ...(input.name !== undefined ? { name: input.name } : {}),
        ...(input.description !== undefined ? { description: input.description ?? null } : {}),
        ...(input.targetType !== undefined
            ? { targetType: PRISMA_PROMOTION_TARGET_TYPE_MAP[input.targetType] }
            : {}),
        ...(input.discountType !== undefined
            ? { discountType: PRISMA_PROMOTION_DISCOUNT_TYPE_MAP[input.discountType] }
            : {}),
        ...(input.percentageOff !== undefined ? { percentageOff: input.percentageOff ?? null } : {}),
        ...(input.fixedCoinOff !== undefined ? { fixedCoinOff: input.fixedCoinOff ?? null } : {}),
        ...(input.usageLimit !== undefined ? { usageLimit: input.usageLimit ?? null } : {}),
        ...(input.startsAt !== undefined ? { startsAt: parseDateOrNull(input.startsAt) } : {}),
        ...(input.endsAt !== undefined ? { endsAt: parseDateOrNull(input.endsAt) } : {}),
        ...(input.isActive !== undefined ? { isActive: input.isActive } : {}),
        ...(input.shopItemId !== undefined
            ? {
                shopItem: input.shopItemId
                    ? { connect: { id: input.shopItemId } }
                    : { disconnect: true },
            }
            : {}),
        ...(input.bundleId !== undefined
            ? {
                bundle: input.bundleId
                    ? { connect: { id: input.bundleId } }
                    : { disconnect: true },
            }
            : {}),
    };
}
