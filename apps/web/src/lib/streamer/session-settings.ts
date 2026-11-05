import { z } from "zod";
import {
    BROADCAST_THEMES,
    CAMERA_SIZES,
    CAMERA_SLOTS,
    TIMER_STYLES,
    type StreamScreenSettings,
} from "@hushle/domain-streamer";

// What a streamer chooses when opening a session. The validated object is stored as the
// session row's `settings` JSON and prefills the next session's form.

export const STREAM_ROUND_DURATION = { min: 30, max: 120, default: 60 } as const;
export const MAX_STREAM_CATEGORIES = 20;

// The stream-screen fields, shared by session creation and live changes (streamer:host:settings).
const screenFields = {
    theme: z.enum(BROADCAST_THEMES),
    camera: z.enum(CAMERA_SLOTS),
    cameraSize: z.enum(CAMERA_SIZES),
    clock: z.enum(TIMER_STYLES).nullable(),
    cardBack: z.object({ collection: z.number().int().min(-1) }).strict().nullable(),
    showCardName: z.boolean(),
};

export const createSessionInputSchema = z
    .object({
        platform: z.enum(["twitch", "kick"]),
        language: z.enum(["tr", "en"]),
        categoryIds: z.array(z.number().int().positive()).min(1).max(MAX_STREAM_CATEGORIES),
        difficulties: z.array(z.union([z.literal(1), z.literal(2), z.literal(3)])).min(1),
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

export function toScreenSettings(input: CreateSessionInput, channel: StreamScreenSettings["channel"]): StreamScreenSettings {
    return {
        theme: input.theme,
        camera: input.camera,
        cameraSize: input.cameraSize,
        clock: input.clock,
        cardBack: input.cardBack ? { collection: input.cardBack.collection } : null,
        showCardName: input.showCardName,
        duration: input.duration,
        language: input.language,
        tolerance: input.tolerance,
        channel: channel ? { ...channel } : null,
    };
}

export type ScreenFields = Pick<StreamScreenSettings, keyof ScreenSettingsPatch>;

/** The fields a live patch sets, ready to spread over the session's settings; absent keys stay as they were. */
export function screenPatchFields(patch: ScreenSettingsPatch): Partial<ScreenFields> {
    const fields: Partial<ScreenFields> = {};
    if (patch.theme !== undefined) fields.theme = patch.theme;
    if (patch.camera !== undefined) fields.camera = patch.camera;
    if (patch.cameraSize !== undefined) fields.cameraSize = patch.cameraSize;
    if (patch.clock !== undefined) fields.clock = patch.clock;
    if (patch.cardBack !== undefined) fields.cardBack = patch.cardBack ? { collection: patch.cardBack.collection } : null;
    if (patch.showCardName !== undefined) fields.showCardName = patch.showCardName;
    return fields;
}
