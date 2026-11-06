import { z } from "zod";
import {
    boundCardBack,
    BROADCAST_THEMES,
    CAMERA_SIZES,
    CAMERA_SLOTS,
    TIMER_STYLES,
    type ResolvedCardThemeLike,
    type StreamCardBack,
    type StreamScreenSettings,
} from "@hushle/domain-streamer";

// What a streamer chooses when opening a session. The validated object is stored as the
// session row's `settings` JSON and prefills the next session's form.

export const STREAM_ROUND_DURATION = { min: 30, max: 120, default: 60 } as const;
export const MAX_STREAM_CATEGORIES = 20;
/** The most entries a raw category or difficulty list may have, before the dedupe. */
export const MAX_RAW_LIST_ENTRIES = 100;

// The stream-screen fields, shared by session creation and live changes (streamer:host:settings).
const screenFields = {
    theme: z.enum(BROADCAST_THEMES),
    camera: z.enum(CAMERA_SLOTS),
    cameraSize: z.enum(CAMERA_SIZES),
    clock: z.enum(TIMER_STYLES).nullable(),
    cardBack: z.object({ itemId: z.number().int().positive() }).strict().nullable(),
    showCardName: z.boolean(),
};

/** The values in first-seen order, each once. */
function distinct<T>(values: T[]): T[] {
    return [...new Set(values)];
}

const categoryId = z.number().int().positive();
const difficulty = z.union([z.literal(1), z.literal(2), z.literal(3)]);

// Lists are stored deduplicated, both the same way: the raw list is capped first (so a huge one
// is refused before any work), then repeats collapse, then the cap counts distinct entries.
export const createSessionInputSchema = z
    .object({
        platform: z.enum(["twitch", "kick"]),
        language: z.enum(["tr", "en"]),
        categoryIds: z
            .array(categoryId)
            .min(1)
            .max(MAX_RAW_LIST_ENTRIES)
            .transform(distinct)
            .pipe(z.array(categoryId).max(MAX_STREAM_CATEGORIES)),
        difficulties: z.array(difficulty).min(1).max(MAX_RAW_LIST_ENTRIES).transform(distinct).pipe(z.array(difficulty).max(3)),
        duration: z.number().int().min(STREAM_ROUND_DURATION.min).max(STREAM_ROUND_DURATION.max),
        tolerance: z.enum(["strict", "normal"]),
        ...screenFields,
    })
    .strict();

export type CreateSessionInput = z.infer<typeof createSessionInputSchema>;

export const screenSettingsPatchSchema = z.object(screenFields).partial().strict();

export type ScreenSettingsPatch = z.infer<typeof screenSettingsPatchSchema>;

export interface WordFilters {
    categoryIds: number[];
    difficulties: number[];
    locale: CreateSessionInput["language"];
}

export function wordFiltersOf(input: CreateSessionInput): WordFilters {
    return { categoryIds: [...input.categoryIds], difficulties: [...input.difficulties], locale: input.language };
}

/** A live patch whose card back the caller already resolved (and checked) into what the screen shows. */
export type ResolvedScreenPatch = Omit<ScreenSettingsPatch, "cardBack"> & { cardBack?: StreamCardBack | null };

// The shape of a resolved card back (card-backs.ts builds it); unknown keys are dropped. The values
// are then bounded by the domain's own card-back validator (boundCardBack), the one the public
// projection uses: a live patch keeps nothing the stream screen would not draw.
const cardBackThemeSchema = z.object({
    renderSpecVersion: z.number(),
    requestedRenderSpecVersion: z.number(),
    usedRenderSpecFallback: z.boolean(),
    surfaceColor: z.string(),
    borderColor: z.string(),
    accentColor: z.string(),
    secondaryColor: z.string(),
    titleColor: z.string(),
    detailColor: z.string(),
    pattern: z.string(),
    patternOpacity: z.number(),
    patternScale: z.number(),
    motionPreset: z.string(),
    motionSpeedMs: z.number(),
    glowColor: z.string(),
    glowBlur: z.number(),
    glowOpacity: z.number(),
    overlayImageUrl: z.string().nullable(),
    overlayOpacity: z.number(),
}) satisfies z.ZodType<ResolvedCardThemeLike>;

const resolvedCardBackSchema = z
    .object({
        itemId: z.number().int().positive(),
        name: z.string(),
        theme: cardBackThemeSchema,
        imageUrl: z.string().nullable(),
    })
    // A positive integer item id and a theme object: boundCardBack always answers a card back here.
    .transform((cardBack) => boundCardBack(cardBack) ?? cardBack) satisfies z.ZodType<StreamCardBack>;

/** What the runtime takes as a live patch: `screenSettingsPatchSchema`, with the card back already resolved. */
export const resolvedScreenPatchSchema = screenSettingsPatchSchema.extend({
    cardBack: resolvedCardBackSchema.nullable().optional(),
}) satisfies z.ZodType<ResolvedScreenPatch>;

export function toScreenSettings(
    input: CreateSessionInput,
    channel: StreamScreenSettings["channel"],
    cardBack: StreamCardBack | null = null,
): StreamScreenSettings {
    return {
        theme: input.theme,
        camera: input.camera,
        cameraSize: input.cameraSize,
        clock: input.clock,
        cardBack: input.cardBack ? cardBack : null,
        showCardName: input.showCardName,
        duration: input.duration,
        language: input.language,
        tolerance: input.tolerance,
        channel: channel ? { ...channel } : null,
    };
}

export type ScreenFields = Pick<StreamScreenSettings, keyof ScreenSettingsPatch>;

/** The stored form of a resolved patch (the session row keeps the choice, not the resolved theme). */
export function screenPatchInput(patch: ResolvedScreenPatch): Partial<ScreenSettingsPatch> {
    const { cardBack, ...rest } = patch;
    const stored: Partial<ScreenSettingsPatch> = { ...rest };
    if (cardBack !== undefined) stored.cardBack = cardBack ? { itemId: cardBack.itemId } : null;
    return stored;
}

/** The fields a live patch sets, ready to spread over the session's settings; absent keys stay as they were. */
export function screenPatchFields(patch: ResolvedScreenPatch): Partial<ScreenFields> {
    const fields: Partial<ScreenFields> = {};
    if (patch.theme !== undefined) fields.theme = patch.theme;
    if (patch.camera !== undefined) fields.camera = patch.camera;
    if (patch.cameraSize !== undefined) fields.cameraSize = patch.cameraSize;
    if (patch.clock !== undefined) fields.clock = patch.clock;
    if (patch.cardBack !== undefined) fields.cardBack = patch.cardBack;
    if (patch.showCardName !== undefined) fields.showCardName = patch.showCardName;
    return fields;
}
