import { z } from "zod";

export const notificationListQuerySchema = z.object({
    limit: z.coerce.number().int().min(1).max(50).default(20),
    filter: z.enum(["all", "unread"]).default("all"),
});

export const notificationParamsSchema = z.object({
    id: z.coerce.number().int().min(1),
});

export type NotificationListQuery = z.infer<typeof notificationListQuerySchema>;
