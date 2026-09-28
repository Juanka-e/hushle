import { z } from "zod";
import { WALLET_ADJUSTMENT_TYPES } from "@/types/admin-user-operations";

export const walletAdjustmentSchema = z.object({
    adjustmentType: z.enum(WALLET_ADJUSTMENT_TYPES),
    amount: z.coerce.number().int().min(1).max(1_000_000),
    reason: z.string().trim().min(3).max(500),
});

export type WalletAdjustmentInput = z.infer<typeof walletAdjustmentSchema>;
