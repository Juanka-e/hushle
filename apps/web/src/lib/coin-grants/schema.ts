import { z } from "zod";

const optionalTextSchema = z.string().trim().max(300).optional().nullable();
const codeSchema = z
    .string()
    .trim()
    .min(3)
    .max(80)
    .regex(/^[A-Z0-9_-]+$/i, "Kod sadece harf, rakam, tire ve alt cizgi icerebilir.");

export const coinGrantCampaignWriteSchema = z.object({
    code: codeSchema,
    name: z.string().trim().min(1).max(120),
    description: optionalTextSchema,
    coinAmount: z.number().int().min(1).max(1_000_000),
    totalBudgetCoin: z.number().int().min(1).max(100_000_000).optional().nullable(),
    totalClaimLimit: z.number().int().min(1).max(1_000_000).optional().nullable(),
    perUserClaimLimit: z.number().int().min(1).max(100).default(1),
    startsAt: z.string().datetime().optional().nullable(),
    endsAt: z.string().datetime().optional().nullable(),
    isActive: z.boolean().default(true),
});

export const coinGrantCodeBatchCreateSchema = z.object({
    campaignId: z.number().int().positive(),
    label: z.string().trim().max(120).optional().nullable(),
    manualCode: codeSchema.optional().nullable(),
    prefix: z
        .string()
        .trim()
        .min(2)
        .max(20)
        .regex(/^[A-Z0-9_-]+$/i, "Prefix sadece harf, rakam, tire ve alt cizgi icerebilir.")
        .optional()
        .nullable(),
    quantity: z.number().int().min(1).max(100).default(1),
    maxClaims: z.number().int().min(1).max(1_000_000).optional().nullable(),
    expiresAt: z.string().datetime().optional().nullable(),
    isActive: z.boolean().default(true),
});

export const coinGrantRedeemSchema = z.object({
    code: codeSchema,
});

export type CoinGrantCampaignWriteInput = z.infer<typeof coinGrantCampaignWriteSchema>;
export type CoinGrantCodeBatchCreateInput = z.infer<typeof coinGrantCodeBatchCreateSchema>;
export type CoinGrantRedeemInput = z.infer<typeof coinGrantRedeemSchema>;
