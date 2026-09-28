import { z } from "zod";
import {
    SUPPORT_TICKET_CATEGORIES,
    SUPPORT_TICKET_PRIORITIES,
    SUPPORT_TICKET_STATUSES,
} from "@/types/support";

const supportBodySchema = z.string().trim().min(6).max(2000);

export const supportTicketCreateSchema = z.object({
    category: z.enum(SUPPORT_TICKET_CATEGORIES),
    subject: z.string().trim().min(4).max(160),
    message: supportBodySchema,
});

export const supportTicketReplySchema = z.object({
    body: supportBodySchema,
});

export const supportTicketAdminUpdateSchema = z
    .object({
        status: z.enum(SUPPORT_TICKET_STATUSES).optional(),
        priority: z.enum(SUPPORT_TICKET_PRIORITIES).optional(),
        assignedAdminUserId: z.number().int().positive().nullable().optional(),
    })
    .refine(
        (value) =>
            value.status !== undefined ||
            value.priority !== undefined ||
            value.assignedAdminUserId !== undefined,
        "En az bir alan guncellenmeli."
    );

export const supportTicketAdminMessageSchema = z.object({
    body: supportBodySchema,
    isInternal: z.boolean().default(false),
});

export const supportAdminListQuerySchema = z.object({
    page: z.coerce.number().int().min(1).default(1),
    limit: z.coerce.number().int().min(1).max(50).default(12),
    search: z.string().trim().max(120).default(""),
    status: z.enum(["all", ...SUPPORT_TICKET_STATUSES]).default("all"),
});

export type SupportTicketCreateInput = z.infer<typeof supportTicketCreateSchema>;
export type SupportTicketReplyInput = z.infer<typeof supportTicketReplySchema>;
export type SupportTicketAdminUpdateInput = z.infer<typeof supportTicketAdminUpdateSchema>;
export type SupportTicketAdminMessageInput = z.infer<typeof supportTicketAdminMessageSchema>;
export type SupportAdminListQuery = z.infer<typeof supportAdminListQuerySchema>;

