import { z } from "zod";
import { MODERATION_ACTION_TYPES } from "@/types/moderation";

export const moderationListQuerySchema = z.object({
    page: z.coerce.number().int().min(1).default(1),
    limit: z.coerce.number().int().min(1).max(50).default(15),
    search: z.string().trim().max(80).default(""),
    status: z.enum(["all", "active", "suspended"]).default("all"),
});

export const moderationActionSchema = z
    .object({
        actionType: z.enum(MODERATION_ACTION_TYPES),
        reason: z.string().trim().min(3).max(500),
        suspendedUntil: z.string().datetime().nullable().optional(),
    })
    .superRefine((value, context) => {
        if (value.actionType === "suspend") {
            return;
        }

        if (value.suspendedUntil) {
            context.addIssue({
                code: z.ZodIssueCode.custom,
                message: "Sadece suspend islemi suspendedUntil alabilir.",
                path: ["suspendedUntil"],
            });
        }
    });

export type ModerationActionInput = z.infer<typeof moderationActionSchema>;
