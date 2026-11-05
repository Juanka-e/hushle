import { emitObservabilityEvent, reportError } from "@hushle/platform-observability";
import { prismaStreamerConnectionStore } from "@hushle/platform-streamer";
import { getSystemSettings } from "@/lib/system-settings/service";
import { clearWordPool, getNextWord } from "@/lib/socket/word-service";
import { createStreamerSessionRuntime, type StreamerSessionRuntime, type WordSource } from "./session-runtime";
import type { StreamerSessionServiceDeps } from "./session-service";
import { prismaStreamSessionStore } from "./session-store";

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

function report(event: string, error: unknown): void {
    void reportError({ service: "hushle-web", event, error }).catch(() => undefined);
}

export function getStreamerSessionRuntime(): StreamerSessionRuntime {
    globalForStreamerSessions.__hushleStreamerSessionRuntime ??= createStreamerSessionRuntime({
        store: prismaStreamSessionStore,
        wordSource: wordPoolSource,
        onError: report,
    });
    return globalForStreamerSessions.__hushleStreamerSessionRuntime;
}

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
        (error) => report("streamer_session.boot.reconcile_failed", error),
    );
    await globalForStreamerSessions.__hushleStreamerSessionBoot;
    return runtime;
}

export function createSessionServiceDeps(): StreamerSessionServiceDeps {
    return {
        sessions: prismaStreamSessionStore,
        connections: prismaStreamerConnectionStore,
        runtime: getStreamerSessionRuntime(),
        async getFeatureFlags() {
            const { features } = await getSystemSettings();
            return { streamerShowcaseAllCosmetics: features.streamerShowcaseAllCosmetics === true };
        },
    };
}
