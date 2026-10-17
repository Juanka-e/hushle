import { getSettlementRetryDelayMs } from "./retry-policy";
import type { MatchSettlementSnapshot } from "./types";

export interface SettlementQueueDeps {
    record(snapshot: MatchSettlementSnapshot): Promise<{ id: number }>;
    settle(id: number): Promise<unknown>;
    capacity?: number;
    now?: () => number;
    onDrop?(key: string): void;
    onError?(event: string, error: unknown, context: { key: string }): void;
}

interface BufferedSnapshot {
    snapshot: MatchSettlementSnapshot;
    attempts: number;
    nextAttemptAt: number;
}

export interface SettlementQueue {
    enqueue(snapshot: MatchSettlementSnapshot): Promise<void>;
    flushDue(options?: { force?: boolean }): Promise<number>;
    size(): number;
}

export function getSettlementKey(snapshot: MatchSettlementSnapshot): string {
    return `${snapshot.roomCode}|${snapshot.matchStartedAt}`;
}

/**
 * Bridges brief database outages: a snapshot that cannot be recorded waits in a
 * bounded in-memory buffer. Once recorded, the row itself carries the retries.
 */
export function createSettlementQueue(deps: SettlementQueueDeps): SettlementQueue {
    const capacity = Math.max(1, deps.capacity ?? 500);
    const now = deps.now ?? Date.now;
    const buffer = new Map<string, BufferedSnapshot>();
    const inFlight = new Set<Promise<unknown>>();

    function hold(key: string, snapshot: MatchSettlementSnapshot, attempts: number): void {
        if (!buffer.has(key) && buffer.size >= capacity) {
            const oldest = buffer.keys().next().value;
            if (oldest !== undefined) {
                buffer.delete(oldest);
                deps.onDrop?.(oldest);
            }
        }
        buffer.set(key, {
            snapshot,
            attempts,
            nextAttemptAt: now() + getSettlementRetryDelayMs(attempts),
        });
    }

    async function persist(key: string, snapshot: MatchSettlementSnapshot, attempts: number): Promise<boolean> {
        let id: number;
        try {
            ({ id } = await deps.record(snapshot));
        } catch (error) {
            hold(key, snapshot, attempts);
            deps.onError?.("match_settlement.record.failed", error, { key });
            return false;
        }
        buffer.delete(key);
        try {
            await deps.settle(id);
        } catch (error) {
            deps.onError?.("match_settlement.settle.failed", error, { key });
        }
        return true;
    }

    return {
        async enqueue(snapshot) {
            const key = getSettlementKey(snapshot);
            const previous = buffer.get(key);
            const task = persist(key, snapshot, (previous?.attempts ?? 0) + 1);
            inFlight.add(task);
            try {
                await task;
            } finally {
                inFlight.delete(task);
            }
        },
        async flushDue(options) {
            // A forced flush (shutdown) first lets in-flight records finish or fall back to the buffer.
            if (options?.force) await Promise.allSettled([...inFlight]);
            let recorded = 0;
            const current = now();
            for (const [key, entry] of [...buffer]) {
                if (!options?.force && entry.nextAttemptAt > current) continue;
                if (await persist(key, entry.snapshot, entry.attempts + 1)) recorded += 1;
            }
            return recorded;
        },
        size() {
            return buffer.size;
        },
    };
}
