import { emitObservabilityEvent } from "@hushle/platform-observability";
import {
    createStreamerPlatformClient,
    loadTokenKeyring,
    prismaStreamerConnectionStore,
    StreamerConfigError,
    type TokenKeyring,
} from "@hushle/platform-streamer";
import { getSystemSettings } from "@/lib/system-settings/service";
import { clearWordPool, getNextWord } from "@/lib/socket/word-service";
import {
    createStreamerSessionRuntime,
    type ConnectionCheck,
    type SessionConnection,
    type StreamerSessionRuntime,
    type WordSource,
} from "./session-runtime";
import { reportStreamerSessionError, type StreamerSessionServiceDeps } from "./session-service";
import { prismaStreamSessionStore } from "./session-store";
import { getStreamerModeState } from "./streamer-mode";

// Real wiring for stream sessions: Prisma stores, the shared word pool and one runtime per
// process. The custom server and the Next route bundles evaluate this module separately, so the
// runtime lives on globalThis (dev HMR re-evaluations reuse it instead of doubling the timers).

export const wordPoolSource: WordSource = {
    async next(poolKey, filters) {
        const drawn = await getNextWord(poolKey, filters.categoryIds, filters.difficulties, filters.locale);
        if (!drawn) return null;
        return { wordId: drawn.card.id, target: drawn.card.word, taboos: [...drawn.card.taboo] };
    },
    clear(poolKey) {
        clearWordPool(poolKey);
    },
};

const globalForStreamerSessions = globalThis as typeof globalThis & {
    __hushleStreamerSessionRuntime?: StreamerSessionRuntime;
    __hushleStreamerSessionBoot?: Promise<void>;
};

let keyringCache: TokenKeyring | null = null;

/**
 * The hourly check of a live session's channel link: the panel's validation (refresh, the
 * platform's validate, needs_reconnect or lastValidatedAt). A deployment without the token key or
 * the platform's credentials has nothing to check with: no answer, nothing changes.
 */
async function checkLiveConnection(connection: SessionConnection): Promise<ConnectionCheck> {
    const { checkSessionConnection } = await import("./connections-view");
    try {
        keyringCache ??= loadTokenKeyring(process.env);
    } catch (error) {
        if (error instanceof StreamerConfigError) return "unavailable";
        throw error;
    }
    const keyring = keyringCache;
    return checkSessionConnection({ store: prismaStreamerConnectionStore, keyring, clientFor: (platform) => createStreamerPlatformClient(platform, process.env) }, connection);
}

export function getStreamerSessionRuntime(): StreamerSessionRuntime {
    globalForStreamerSessions.__hushleStreamerSessionRuntime ??= createStreamerSessionRuntime({
        store: prismaStreamSessionStore,
        wordSource: wordPoolSource,
        // Failed writes and ticks reach observability with the session id.
        onError: reportStreamerSessionError,
        checkConnection: checkLiveConnection,
    });
    return globalForStreamerSessions.__hushleStreamerSessionRuntime;
}


// An account action (an admin suspension) ends the user's live session: see session-account.ts.
export { endStreamerSessionsForUser } from "./session-account";

/**
 * Server boot, idempotent: no in-memory session survives a restart, so every row the previous
 * process left `active` becomes `interrupted` — once per process. A database error is reported
 * and does not stop the server. Socket.IO attaches later through `setEmitter` (Task 6).
 */
export async function startStreamerSessionRuntime(): Promise<StreamerSessionRuntime> {
    const runtime = getStreamerSessionRuntime();
    globalForStreamerSessions.__hushleStreamerSessionBoot ??= prismaStreamSessionStore.markInterruptedAll(new Date()).then(
        (interrupted) => {
            if (interrupted === 0) return;
            void emitObservabilityEvent({
                level: "info",
                service: "hushle-web",
                event: "streamer_session.boot.interrupted",
                context: { interrupted },
            }).catch(() => undefined);
        },
        (error) => reportStreamerSessionError("streamer_session.boot.reconcile_failed", error),
    );
    await globalForStreamerSessions.__hushleStreamerSessionBoot;
    // The admin kill switch: when the stored switch reads "off" (checked every 15 s), every live
    // session ends `stopped`; "unknown" (the database away) ends nothing. Cleared by
    // runtime.stop(); a second boot call replaces it.
    runtime.watchMode(getStreamerModeState);
    return runtime;
}

export function createSessionServiceDeps(): StreamerSessionServiceDeps {
    return {
        sessions: prismaStreamSessionStore,
        connections: prismaStreamerConnectionStore,
        runtime: getStreamerSessionRuntime(),
        onError: reportStreamerSessionError,
        async getFeatureFlags() {
            const { features } = await getSystemSettings();
            return { streamerShowcaseAllCosmetics: features.streamerShowcaseAllCosmetics === true };
        },
    };
}
