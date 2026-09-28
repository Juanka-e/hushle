import { z } from "zod";

export const promotionBulkStatusSchema = z.object({
    kind: z.enum(["bundles", "discounts", "coupons"]),
    ids: z.array(z.number().int().positive()).min(1).max(100),
    isActive: z.boolean(),
});

export type PromotionBulkStatusInput = z.infer<
    typeof promotionBulkStatusSchema
>;

export function normalizePromotionBulkIds(ids: number[]): number[] {
    return [...new Set(ids)];
}
