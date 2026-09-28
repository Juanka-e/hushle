import { z } from "zod";

export const adminWalletLedgerParamsSchema = z.object({
    id: z.coerce.number().int().min(1),
});

export const adminWalletLedgerQuerySchema = z.object({
    page: z.coerce.number().int().min(1).default(1),
    limit: z.coerce.number().int().min(1).max(50).default(20),
});
