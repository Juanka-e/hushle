export interface SettlementWorkerDeps {
    flush(options?: { force?: boolean }): Promise<number>;
    sweep(): Promise<unknown>;
    purge(): Promise<number>;
    intervalMs?: number;
    purgeIntervalMs?: number;
    now?: () => number;
    onError?(event: string, error: unknown): void;
}

export interface SettlementWorker {
    start(): void;
    runOnce(): Promise<void>;
    stop(): Promise<void>;
}

/** Periodic flush + sweep + purge. Ticks never overlap; stop() drains once. */
export function createSettlementWorker(deps: SettlementWorkerDeps): SettlementWorker {
    const intervalMs = deps.intervalMs ?? 60_000;
    const purgeIntervalMs = deps.purgeIntervalMs ?? 3_600_000;
    const now = deps.now ?? Date.now;
    let timer: NodeJS.Timeout | null = null;
    let inFlight: Promise<void> | null = null;
    let lastPurgeAt: number | null = null;

    async function tick(): Promise<void> {
        try {
            await deps.flush();
            await deps.sweep();
            const current = now();
            if (lastPurgeAt === null || current - lastPurgeAt >= purgeIntervalMs) {
                lastPurgeAt = current;
                await deps.purge();
            }
        } catch (error) {
            deps.onError?.("match_settlement.worker.tick_failed", error);
        }
    }

    function runOnce(): Promise<void> {
        if (!inFlight) {
            inFlight = tick().finally(() => {
                inFlight = null;
            });
        }
        return inFlight;
    }

    return {
        start() {
            if (timer) return;
            timer = setInterval(() => void runOnce(), intervalMs);
            timer.unref?.();
            void runOnce();
        },
        runOnce,
        async stop() {
            if (timer) {
                clearInterval(timer);
                timer = null;
            }
            if (inFlight) await inFlight;
            try {
                await deps.flush({ force: true });
            } catch (error) {
                deps.onError?.("match_settlement.worker.final_flush_failed", error);
            }
        },
    };
}
