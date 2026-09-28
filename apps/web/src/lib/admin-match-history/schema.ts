import { z } from "zod";

export const adminMatchHistoryParamsSchema = z.object({
    id: z.coerce.number().int().min(1),
});

export const adminMatchHistoryQuerySchema = z.object({
    page: z.coerce.number().int().min(1).max(1_000).default(1),
    limit: z.coerce.number().int().min(1).max(20).default(10),
});

export type AdminMatchHistoryQuery = z.infer<
    typeof adminMatchHistoryQuerySchema
>;
