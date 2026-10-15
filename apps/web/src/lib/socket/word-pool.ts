import type { GameContentLocale } from "@hushle/domain-game";

// ─── Types ─────────────────────────────────────────────────────

export interface WordPoolFilters {
    locale: GameContentLocale;
    categoryIds: readonly number[];
    difficulties: readonly number[];
}

/**
 * Returns up to `limit` eligible word ids that are strictly greater than
 * `afterId`, in ascending id order. An empty filter list means "no filter".
 */
export type WordIdBatchSource = (
    filters: WordPoolFilters,
    afterId: number,
    limit: number
) => Promise<number[]>;

export interface WordPoolOptions {
    source: WordIdBatchSource;
    poolSize: number;
    batchSize?: number;
    random?: () => number;
}

export interface WordPoolManager {
    prime(roomCode: string, filters: WordPoolFilters): Promise<void>;
    takeNextId(roomCode: string, filters: WordPoolFilters): Promise<number | null>;
    discardQueue(roomCode: string): void;
    clear(roomCode: string): void;
    size(roomCode: string): number;
}

interface RoomWordPoolState {
    key: string;
    queue: number[];
    drawn: Set<number>;
    lastDrawnId: number | null;
    eligibleCount: number;
}

interface PrimeTask {
    key: string;
    promise: Promise<void>;
    cancelled: boolean;
}

export interface WordIdSample {
    /** Random sample of ids that were not drawn yet, in random order. */
    unseen: number[];
    /** Random sample of all eligible ids, used to start a new cycle. */
    any: number[];
    eligibleCount: number;
}

// ─── Constants ─────────────────────────────────────────────────

export const DEFAULT_WORD_POOL_SIZE = 120;
export const MAX_WORD_POOL_SIZE = 1_000;
export const DEFAULT_WORD_ID_BATCH_SIZE = 5_000;
// Concurrent draws can find the fresh queue already taken; each retry primes again.
const MAX_TAKE_ATTEMPTS = 8;

// ─── Pure helpers ──────────────────────────────────────────────

export function parseWordPoolSize(value: string | undefined): number {
    const parsed = Number.parseInt(value ?? "", 10);
    if (!Number.isFinite(parsed) || parsed <= 0) {
        return DEFAULT_WORD_POOL_SIZE;
    }
    return Math.min(parsed, MAX_WORD_POOL_SIZE);
}

function normalizeIdList(values: readonly number[]): number[] {
    return [...new Set(values.filter((value) => Number.isInteger(value)))].sort(
        (left, right) => left - right
    );
}

export function normalizeWordPoolFilters(filters: WordPoolFilters): WordPoolFilters {
    return {
        locale: filters.locale,
        categoryIds: normalizeIdList(filters.categoryIds),
        difficulties: normalizeIdList(filters.difficulties),
    };
}

/** Stable identity of a filter set; a room pool is only reused for the same key. */
export function buildWordPoolKey(filters: WordPoolFilters): string {
    const normalized = normalizeWordPoolFilters(filters);
    return [
        normalized.locale,
        `c:${normalized.categoryIds.join(",")}`,
        `d:${normalized.difficulties.join(",")}`,
    ].join("|");
}

export function shuffleInPlace<T>(items: T[], random: () => number = Math.random): T[] {
    for (let i = items.length - 1; i > 0; i--) {
        const j = Math.floor(random() * (i + 1));
        [items[i], items[j]] = [items[j], items[i]];
    }
    return items;
}

/**
 * Uniform fixed-size sample over a stream of unknown length (Algorithm R).
 * Memory stays at `capacity` items no matter how many ids are offered.
 */
export function createReservoir(capacity: number, random: () => number = Math.random) {
    const items: number[] = [];
    let offered = 0;

    return {
        offer(id: number): void {
            offered += 1;
            if (items.length < capacity) {
                items.push(id);
                return;
            }
            const slot = Math.floor(random() * offered);
            if (slot < capacity) {
                items[slot] = id;
            }
        },
        get offered(): number {
            return offered;
        },
        /** Sampled ids in random order. */
        takeShuffled(): number[] {
            return shuffleInPlace([...items], random);
        },
    };
}

/**
 * Streams every eligible id in ascending batches and samples `size` of them,
 * so every eligible word can be chosen whatever the table size.
 */
export async function sampleEligibleWordIds(
    source: WordIdBatchSource,
    filters: WordPoolFilters,
    options: {
        size: number;
        batchSize?: number;
        exclude?: ReadonlySet<number>;
        random?: () => number;
    }
): Promise<WordIdSample> {
    const random = options.random ?? Math.random;
    const batchSize = Math.max(1, Math.floor(options.batchSize ?? DEFAULT_WORD_ID_BATCH_SIZE));
    const size = Math.max(0, Math.floor(options.size));
    const exclude = options.exclude;
    const unseen = createReservoir(size, random);
    const any = createReservoir(size, random);
    let eligibleCount = 0;
    let afterId = 0;

    for (;;) {
        const batch = await source(filters, afterId, batchSize);
        for (const id of batch) {
            eligibleCount += 1;
            any.offer(id);
            if (!exclude?.has(id)) {
                unseen.offer(id);
            }
        }
        if (batch.length < batchSize) {
            break;
        }
        const lastId = batch[batch.length - 1];
        if (!(lastId > afterId)) {
            throw new Error("Word id source must return ascending ids after the cursor.");
        }
        afterId = lastId;
    }

    return {
        unseen: unseen.takeShuffled(),
        any: any.takeShuffled(),
        eligibleCount,
    };
}

// ─── Room pool manager ─────────────────────────────────────────

/**
 * Per-room queue of word ids. A game never repeats a word until every
 * eligible word has been drawn once; then a new cycle starts.
 */
export function createWordPoolManager(options: WordPoolOptions): WordPoolManager {
    const random = options.random ?? Math.random;
    const poolSize = Math.max(1, Math.floor(options.poolSize));
    const batchSize = options.batchSize ?? DEFAULT_WORD_ID_BATCH_SIZE;
    const states = new Map<string, RoomWordPoolState>();
    const primeTasks = new Map<string, PrimeTask>();

    async function runPrime(
        roomCode: string,
        filters: WordPoolFilters,
        key: string,
        task: PrimeTask
    ): Promise<void> {
        const current = states.get(roomCode);
        const drawn = current && current.key === key ? current.drawn : new Set<number>();
        const sample = await sampleEligibleWordIds(options.source, filters, {
            size: poolSize,
            batchSize,
            exclude: drawn,
            random,
        });

        if (task.cancelled) {
            return;
        }

        // Re-read after the await: the state may have moved on meanwhile.
        const latest = states.get(roomCode);
        const state: RoomWordPoolState =
            latest && latest.key === key
                ? latest
                : {
                    key,
                    queue: [],
                    drawn: new Set<number>(),
                    lastDrawnId: null,
                    eligibleCount: 0,
                };

        state.eligibleCount = sample.eligibleCount;
        // Ids drawn while the sample was being built are dropped here.
        state.queue = sample.unseen.filter((id) => !state.drawn.has(id));

        if (sample.unseen.length === 0 && sample.any.length > 0) {
            // Every eligible word was drawn in this cycle: start a new one,
            // but do not show the last word twice in a row.
            state.drawn.clear();
            state.queue = sample.any;
            if (
                state.queue.length > 1 &&
                state.lastDrawnId !== null &&
                state.queue[0] === state.lastDrawnId
            ) {
                const swapIndex = 1 + Math.floor(random() * (state.queue.length - 1));
                [state.queue[0], state.queue[swapIndex]] = [
                    state.queue[swapIndex],
                    state.queue[0],
                ];
            }
        }

        states.set(roomCode, state);
    }

    async function prime(roomCode: string, rawFilters: WordPoolFilters): Promise<void> {
        const filters = normalizeWordPoolFilters(rawFilters);
        const key = buildWordPoolKey(filters);

        // If already priming, wait for it to finish (cache stampede guard).
        let pending = primeTasks.get(roomCode);
        while (pending) {
            await pending.promise;
            if (pending.key === key && !pending.cancelled) {
                return;
            }
            pending = primeTasks.get(roomCode);
        }

        const task: PrimeTask = { key, promise: Promise.resolve(), cancelled: false };
        task.promise = (async () => {
            try {
                await runPrime(roomCode, filters, key, task);
            } finally {
                if (primeTasks.get(roomCode) === task) {
                    primeTasks.delete(roomCode);
                }
            }
        })();
        primeTasks.set(roomCode, task);
        await task.promise;
    }

    async function takeNextId(
        roomCode: string,
        rawFilters: WordPoolFilters
    ): Promise<number | null> {
        const filters = normalizeWordPoolFilters(rawFilters);
        const key = buildWordPoolKey(filters);

        for (let attempt = 0; attempt < MAX_TAKE_ATTEMPTS; attempt++) {
            const state = states.get(roomCode);
            if (state && state.key === key && state.queue.length > 0) {
                const id = state.queue.shift()!;
                state.drawn.add(id);
                state.lastDrawnId = id;
                return id;
            }

            await prime(roomCode, filters);

            const primed = states.get(roomCode);
            if (
                primed &&
                primed.key === key &&
                primed.queue.length === 0 &&
                primed.eligibleCount === 0
            ) {
                // No eligible words for these filters.
                return null;
            }
        }

        return null;
    }

    function discardQueue(roomCode: string): void {
        const state = states.get(roomCode);
        if (state) {
            state.queue = [];
        }
    }

    function clear(roomCode: string): void {
        states.delete(roomCode);
        const task = primeTasks.get(roomCode);
        if (task) {
            task.cancelled = true;
            primeTasks.delete(roomCode);
        }
    }

    function size(roomCode: string): number {
        return states.get(roomCode)?.queue.length ?? 0;
    }

    return { prime, takeNextId, discardQueue, clear, size };
}
