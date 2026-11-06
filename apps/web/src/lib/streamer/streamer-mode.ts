import { prisma } from "@/lib/prisma";
import { DEFAULT_SYSTEM_SETTINGS, normalizeSystemSettings } from "@/lib/system-settings/schema";
import { realStreamerTimers, type StreamerTimers } from "./session-timers";
import type { StreamerModeState } from "./session-watch";

// The admin's streamer-mode switch as the live sessions need it: authoritative. The cached
// settings service falls back to the defaults (mode off) while the database is away, and caches
// that fallback; read through it, a database blip would look like the admin switching the mode
// off and the kill switch would end every live stream. This read asks the stored `features` row
// itself and says "unknown" whenever it cannot know.

export type { StreamerModeState } from "./session-watch";

/** How long one read of the switch may take before it counts as unknown. */
export const STREAMER_MODE_READ_TIMEOUT_MS = 2_000;
/** How long an on or off answer is reused; unknown is never reused. */
export const STREAMER_MODE_CACHE_MS = 5_000;

export interface StreamerModeReaderDeps {
    /** The stored `features` setting (null without a row); throws when the database does not answer. */
    readFeatures(): Promise<unknown>;
    timers?: StreamerTimers;
    timeoutMs?: number;
    cacheMs?: number;
}

/**
 * A reader of the switch: "on" or "off" from the stored row (normalized as the settings service
 * does), else "unknown". Concurrent callers share one read in flight, whatever it answers, so a
 * database outage never piles queries on the pool; "unknown" is never kept once it settled.
 */
export function createStreamerModeReader(deps: StreamerModeReaderDeps): () => Promise<StreamerModeState> {
    const timers = deps.timers ?? realStreamerTimers;
    const timeoutMs = deps.timeoutMs ?? STREAMER_MODE_READ_TIMEOUT_MS;
    const cacheMs = deps.cacheMs ?? STREAMER_MODE_CACHE_MS;
    let cached: { state: "on" | "off"; at: number } | null = null;
    let inFlight: Promise<StreamerModeState> | null = null;
    const readOnce = async (): Promise<StreamerModeState> => {
        let handle: unknown;
        const timedOut = new Promise<never>((_, reject) => {
            handle = timers.setTimeout(() => reject(new Error(`the streamer-mode read took longer than ${timeoutMs} ms`)), timeoutMs);
        });
        try {
            const stored = await Promise.race([deps.readFeatures(), timedOut]);
            // No row is the default; a row is read exactly as the settings service reads it.
            const settings = normalizeSystemSettings(stored === null || stored === undefined ? DEFAULT_SYSTEM_SETTINGS : { ...DEFAULT_SYSTEM_SETTINGS, features: stored });
            const state = settings.features.streamerModeEnabled === true ? "on" : "off";
            cached = { state, at: timers.now() };
            return state;
        } catch {
            return "unknown";
        } finally {
            timers.clearTimeout(handle);
        }
    };
    return () => {
        if (cached && timers.now() - cached.at < cacheMs) return Promise.resolve(cached.state);
        if (!inFlight) {
            const read = readOnce();
            inFlight = read;
            void read.then(() => {
                if (inFlight === read) inFlight = null;
            });
        }
        return inFlight;
    };
}

// On globalThis: the custom server and the route bundles share one reader (and its cache).
const globalForStreamerMode = globalThis as typeof globalThis & { __hushleStreamerModeReader?: () => Promise<StreamerModeState> };

/** The switch as stored: "on", "off", or "unknown" while the database does not answer (never cached). */
export function getStreamerModeState(): Promise<StreamerModeState> {
    globalForStreamerMode.__hushleStreamerModeReader ??= createStreamerModeReader({
        async readFeatures() {
            const row = await prisma.systemSetting.findUnique({ where: { key: "features" }, select: { value: true } });
            return row ? row.value : null;
        },
    });
    return globalForStreamerMode.__hushleStreamerModeReader();
}
