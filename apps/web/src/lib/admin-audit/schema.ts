import { z } from "zod";

export const adminAuditEconomyGuardFilterValues = [
    "",
    "match_reward",
    "triggered",
    "ceiling",
    "repeated_group",
] as const;

export const adminAuditSourceFilterValues = ["hot", "archive"] as const;

export const adminAuditListQuerySchema = z.object({
    page: z.coerce.number().int().min(1).default(1),
    limit: z.coerce.number().int().min(1).max(50).default(15),
    search: z.string().trim().max(120).default(""),
    action: z.string().trim().max(80).default(""),
    resourceType: z.string().trim().max(80).default(""),
    actorRole: z.string().trim().max(20).default(""),
    economyGuard: z.enum(adminAuditEconomyGuardFilterValues).default(""),
    source: z.enum(adminAuditSourceFilterValues).default("hot"),
});

export type AdminAuditListQuery = z.infer<typeof adminAuditListQuerySchema>;
