import { z } from "zod";
import { announcementBlocksSchema, createEmptyAnnouncementBlocks } from "./content";
import { SUPPORTED_LOCALES, type AppLocale } from "@/lib/i18n/config";

export const announcementTypeSchema = z.enum(["guncelleme", "duyuru", "sss"]);
export type AnnouncementType = z.infer<typeof announcementTypeSchema>;

export const announcementTranslationSchema = z.object({
    title: z.string().trim().min(1).max(255),
    contentBlocks: announcementBlocksSchema,
});

export const announcementTranslationsSchema = z
    .object({
        tr: announcementTranslationSchema,
        en: announcementTranslationSchema.optional().nullable(),
    })
    .strict();

export type AnnouncementTranslationInput = z.infer<typeof announcementTranslationSchema>;
export type AnnouncementTranslationsInput = z.infer<typeof announcementTranslationsSchema>;

export function createEmptyAnnouncementTranslations(): AnnouncementTranslationsInput {
    return {
        tr: { title: "", contentBlocks: createEmptyAnnouncementBlocks() },
        en: null,
    };
}

export function normalizeRequestedAnnouncementLocale(value: unknown): AppLocale {
    return SUPPORTED_LOCALES.includes(value as AppLocale) ? (value as AppLocale) : "tr";
}

export function hasTranslationContent(value: {
    title: string;
    contentBlocks: unknown[];
} | null | undefined): boolean {
    return Boolean(value?.title.trim() && value.contentBlocks.length > 0);
}
