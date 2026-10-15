import assert from "node:assert/strict";
import type { GameContentLocale } from "@hushle/domain-game";
import {
    buildWordPoolKey,
    createReservoir,
    createWordPoolManager,
    DEFAULT_WORD_POOL_SIZE,
    MAX_WORD_POOL_SIZE,
    normalizeWordPoolFilters,
    parseWordPoolSize,
    sampleEligibleWordIds,
    shuffleInPlace,
    type WordIdBatchSource,
    type WordPoolFilters,
} from "../apps/web/src/lib/socket/word-pool";

// ─── Fixtures ──────────────────────────────────────────────────

interface FakeWord {
    id: number;
    locale: string;
    difficulty: number;
    categoryIds: number[];
}

interface FakeSource {
    source: WordIdBatchSource;
    calls: Array<{ afterId: number; limit: number }>;
    scans(): number;
}

/** Same semantics as the Prisma query: locale, categories (any), difficulties, id cursor. */
function createFakeSource(
    words: FakeWord[],
    options: { delayMs?: number; gate?: Promise<void>; fail?: () => boolean } = {}
): FakeSource {
    const calls: Array<{ afterId: number; limit: number }> = [];
    const sorted = [...words].sort((left, right) => left.id - right.id);
    const source: WordIdBatchSource = async (filters, afterId, limit) => {
        calls.push({ afterId, limit });
        if (options.gate) {
            await options.gate;
        }
        if (options.delayMs) {
            await new Promise((resolve) => setTimeout(resolve, options.delayMs));
        }
        if (options.fail?.()) {
            throw new Error("fake source failure");
        }
        return sorted
            .filter(
                (word) =>
                    word.id > afterId &&
                    word.locale === filters.locale &&
                    (filters.difficulties.length === 0 ||
                        filters.difficulties.includes(word.difficulty)) &&
                    (filters.categoryIds.length === 0 ||
                        word.categoryIds.some((id) => filters.categoryIds.includes(id)))
            )
            .slice(0, limit)
            .map((word) => word.id);
    };
    return {
        source,
        calls,
        scans: () => calls.filter((call) => call.afterId === 0).length,
    };
}

function makeWords(count: number, overrides: Partial<FakeWord> = {}, startId = 1): FakeWord[] {
    return Array.from({ length: count }, (_, index) => ({
        id: startId + index,
        locale: "tr",
        difficulty: (index % 3) + 1,
        categoryIds: [1],
        ...overrides,
    }));
}

function mulberry32(seed: number): () => number {
    let state = seed >>> 0;
    return () => {
        state = (state + 0x6d2b79f5) >>> 0;
        let t = state;
        t = Math.imul(t ^ (t >>> 15), t | 1);
        t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
        return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
}

function filters(
    categoryIds: number[] = [],
    difficulties: number[] = [],
    locale: GameContentLocale = "tr"
): WordPoolFilters {
    return { locale, categoryIds, difficulties };
}

async function drawMany(
    manager: ReturnType<typeof createWordPoolManager>,
    roomCode: string,
    poolFilters: WordPoolFilters,
    count: number
): Promise<Array<number | null>> {
    const ids: Array<number | null> = [];
    for (let index = 0; index < count; index++) {
        ids.push(await manager.takeNextId(roomCode, poolFilters));
    }
    return ids;
}

function assertNoDuplicates(ids: Array<number | null>, label: string): void {
    assert.equal(new Set(ids).size, ids.length, `${label}: duplicate ids ${ids.join(",")}`);
}

function assertWithin(actual: number, expected: number, ratio: number, label: string): void {
    assert.ok(
        Math.abs(actual - expected) <= expected * ratio,
        `${label}: ${actual} is not within ${ratio * 100}% of ${expected}`
    );
}

const tests: Array<[string, () => void | Promise<void>]> = [];
function test(name: string, run: () => void | Promise<void>): void {
    tests.push([name, run]);
}

// ─── Pure helpers ──────────────────────────────────────────────

test("pool size env falls back and clamps", () => {
    assert.equal(parseWordPoolSize(undefined), DEFAULT_WORD_POOL_SIZE);
    assert.equal(parseWordPoolSize(""), DEFAULT_WORD_POOL_SIZE);
    assert.equal(parseWordPoolSize("abc"), DEFAULT_WORD_POOL_SIZE);
    assert.equal(parseWordPoolSize("0"), DEFAULT_WORD_POOL_SIZE);
    assert.equal(parseWordPoolSize("-5"), DEFAULT_WORD_POOL_SIZE);
    assert.equal(parseWordPoolSize("50"), 50);
    assert.equal(parseWordPoolSize("12.7"), 12);
    assert.equal(parseWordPoolSize("999999"), MAX_WORD_POOL_SIZE);
});

test("filter key ignores order and duplicates but not values", () => {
    const base = buildWordPoolKey(filters([3, 1, 2], [2, 1]));
    assert.equal(buildWordPoolKey(filters([1, 2, 3, 3], [1, 2, 2])), base);
    assert.notEqual(buildWordPoolKey(filters([1, 2], [1, 2])), base);
    assert.notEqual(buildWordPoolKey(filters([1, 2, 3], [1])), base);
    assert.notEqual(buildWordPoolKey(filters([1, 2, 3], [1, 2], "en")), base);
    assert.notEqual(buildWordPoolKey(filters([], [12])), buildWordPoolKey(filters([1], [2])));
    assert.deepEqual(normalizeWordPoolFilters(filters([5, 5, 2, 1.5], [3, 1])), {
        locale: "tr",
        categoryIds: [2, 5],
        difficulties: [1, 3],
    });
});

test("shuffle keeps every element", () => {
    const random = mulberry32(1);
    const items = Array.from({ length: 100 }, (_, index) => index);
    const shuffled = shuffleInPlace([...items], random);
    assert.deepEqual([...shuffled].sort((a, b) => a - b), items);
    assert.notDeepEqual(shuffled, items);
    assert.deepEqual(shuffleInPlace([], random), []);
    assert.deepEqual(shuffleInPlace([7], random), [7]);
});

test("reservoir edge cases", () => {
    const random = mulberry32(2);
    const empty = createReservoir(0, random);
    empty.offer(1);
    empty.offer(2);
    assert.deepEqual(empty.takeShuffled(), []);
    assert.equal(empty.offered, 2);

    const small = createReservoir(10, random);
    [4, 5, 6].forEach((id) => small.offer(id));
    assert.deepEqual(small.takeShuffled().sort((a, b) => a - b), [4, 5, 6]);

    const exact = createReservoir(5, random);
    [1, 2, 3, 4, 5].forEach((id) => exact.offer(id));
    assert.deepEqual(exact.takeShuffled().sort((a, b) => a - b), [1, 2, 3, 4, 5]);
});

test("reservoir picks every id with equal probability", () => {
    const random = mulberry32(3);
    const runs = 20_000;
    const counts = new Map<number, number>();
    for (let run = 0; run < runs; run++) {
        const reservoir = createReservoir(10, random);
        for (let id = 1; id <= 50; id++) {
            reservoir.offer(id);
        }
        const sample = reservoir.takeShuffled();
        assertNoDuplicates(sample, "reservoir sample");
        assert.equal(sample.length, 10);
        for (const id of sample) {
            counts.set(id, (counts.get(id) ?? 0) + 1);
        }
    }
    // Expected 20000 * 10 / 50 = 4000 per id (sd ~57).
    for (let id = 1; id <= 50; id++) {
        assertWithin(counts.get(id) ?? 0, 4000, 0.08, `id ${id}`);
    }
});

// ─── Streaming sample ──────────────────────────────────────────

test("sampling zero eligible words", async () => {
    const fake = createFakeSource([]);
    const sample = await sampleEligibleWordIds(fake.source, filters(), { size: 10 });
    assert.deepEqual(sample, { unseen: [], any: [], eligibleCount: 0 });
    assert.equal(fake.calls.length, 1);
});

test("sampling fewer, exactly and more than the pool size", async () => {
    const random = mulberry32(4);
    for (const [count, expected] of [
        [7, 7],
        [10, 10],
        [11, 10],
        [1, 1],
    ] as const) {
        const fake = createFakeSource(makeWords(count));
        const sample = await sampleEligibleWordIds(fake.source, filters(), {
            size: 10,
            random,
        });
        assert.equal(sample.unseen.length, expected, `count ${count}`);
        assert.equal(sample.eligibleCount, count);
        assertNoDuplicates(sample.unseen, `count ${count}`);
        assert.ok(sample.unseen.every((id) => id >= 1 && id <= count));
    }
});

test("sampling walks every batch with an id cursor", async () => {
    const fake = createFakeSource(makeWords(1234));
    const sample = await sampleEligibleWordIds(fake.source, filters(), {
        size: 120,
        batchSize: 100,
        random: mulberry32(5),
    });
    assert.equal(sample.eligibleCount, 1234);
    assert.equal(fake.calls.length, 13);
    assert.deepEqual(
        fake.calls.map((call) => call.afterId),
        [0, 100, 200, 300, 400, 500, 600, 700, 800, 900, 1000, 1100, 1200]
    );

    // A multiple of the batch size needs one extra (empty) read.
    const exact = createFakeSource(makeWords(300));
    const exactSample = await sampleEligibleWordIds(exact.source, filters(), {
        size: 120,
        batchSize: 100,
    });
    assert.equal(exactSample.eligibleCount, 300);
    assert.equal(exact.calls.length, 4);
});

test("sampling honours the exclude set", async () => {
    const fake = createFakeSource(makeWords(20));
    const exclude = new Set([1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 15]);
    const sample = await sampleEligibleWordIds(fake.source, filters(), {
        size: 10,
        exclude,
        random: mulberry32(6),
    });
    assert.deepEqual([...sample.unseen].sort((a, b) => a - b), [16, 17, 18, 19, 20]);
    assert.equal(sample.any.length, 10);
    assert.equal(sample.eligibleCount, 20);
});

test("sampling rejects a cursor that does not advance", async () => {
    const stuck: WordIdBatchSource = async () => [5, 5];
    await assert.rejects(
        sampleEligibleWordIds(stuck, filters(), { size: 10, batchSize: 2 }),
        /ascending ids/
    );
});

test("every word is reachable past the old 500-row cap", async () => {
    // The old query loaded max(POOL_SIZE * 2, 500) rows without ORDER BY,
    // so ids after the first 500 were never drawn.
    const words = makeWords(600);
    const fake = createFakeSource(words);
    const random = mulberry32(7);
    const runs = 2_000;
    const counts = new Map<number, number>();
    for (let run = 0; run < runs; run++) {
        const sample = await sampleEligibleWordIds(fake.source, filters(), {
            size: 120,
            batchSize: 250,
            random,
        });
        assert.equal(sample.unseen.length, 120);
        assertNoDuplicates(sample.unseen, "pool");
        for (const id of sample.unseen) {
            counts.set(id, (counts.get(id) ?? 0) + 1);
        }
    }
    // Expected 2000 * 120 / 600 = 400 per id (sd ~18).
    for (const word of words) {
        assertWithin(counts.get(word.id) ?? 0, 400, 0.2, `id ${word.id}`);
    }
});

test("large tables keep memory at the pool size", async () => {
    const fake = createFakeSource(makeWords(20_000));
    const sample = await sampleEligibleWordIds(fake.source, filters(), {
        size: 120,
        batchSize: 5_000,
        random: mulberry32(8),
    });
    assert.equal(sample.eligibleCount, 20_000);
    assert.equal(sample.unseen.length, 120);
    assert.equal(sample.any.length, 120);
    assert.equal(fake.calls.length, 5);
    assert.ok(sample.unseen.some((id) => id > 15_000), "tail of the table is sampled");
});

// ─── Room manager ──────────────────────────────────────────────

test("no eligible words returns null and keeps working", async () => {
    const fake = createFakeSource(makeWords(5, { locale: "en" }));
    const manager = createWordPoolManager({ source: fake.source, poolSize: 10 });
    assert.equal(await manager.takeNextId("R0", filters()), null);
    assert.equal(await manager.takeNextId("R0", filters()), null);
    assert.equal(manager.size("R0"), 0);
    assert.equal(await manager.takeNextId("R0", filters([], [], "en")) !== null, true);
});

test("a game never repeats a word until every word was drawn", async () => {
    const fake = createFakeSource(makeWords(50));
    const manager = createWordPoolManager({
        source: fake.source,
        poolSize: 10,
        random: mulberry32(9),
    });
    const firstCycle = await drawMany(manager, "R1", filters(), 50);
    assertNoDuplicates(firstCycle, "first cycle");
    assert.equal(new Set(firstCycle).size, 50);
    assert.equal(fake.scans(), 5, "refilled every 10 draws");

    const secondCycle = await drawMany(manager, "R1", filters(), 50);
    assertNoDuplicates(secondCycle, "second cycle");
    assert.notEqual(secondCycle[0], firstCycle[49], "no back-to-back repeat at cycle edge");
});

test("fewer words than the pool size", async () => {
    const fake = createFakeSource(makeWords(3));
    const manager = createWordPoolManager({
        source: fake.source,
        poolSize: 10,
        random: mulberry32(10),
    });
    for (let game = 0; game < 50; game++) {
        const room = `R2-${game}`;
        const draws = await drawMany(manager, room, filters(), 9);
        assertNoDuplicates(draws.slice(0, 3), "cycle 1");
        assertNoDuplicates(draws.slice(3, 6), "cycle 2");
        assertNoDuplicates(draws.slice(6, 9), "cycle 3");
        for (let index = 1; index < draws.length; index++) {
            assert.notEqual(draws[index], draws[index - 1], "back-to-back repeat");
        }
    }
});

test("exactly the pool size", async () => {
    const fake = createFakeSource(makeWords(10));
    const manager = createWordPoolManager({
        source: fake.source,
        poolSize: 10,
        random: mulberry32(11),
    });
    const draws = await drawMany(manager, "R3", filters(), 10);
    assert.deepEqual([...draws].sort((a, b) => a! - b!), [1, 2, 3, 4, 5, 6, 7, 8, 9, 10]);
    assert.equal(fake.scans(), 1);
    assert.equal(manager.size("R3"), 0);
    const next = await manager.takeNextId("R3", filters());
    assert.notEqual(next, null);
    assert.notEqual(next, draws[9]);
});

test("a single word is served again and again", async () => {
    const fake = createFakeSource(makeWords(1));
    const manager = createWordPoolManager({ source: fake.source, poolSize: 10 });
    assert.deepEqual(await drawMany(manager, "R4", filters(), 4), [1, 1, 1, 1]);
});

test("locale, category, subcategory and difficulty filters are respected", async () => {
    const words: FakeWord[] = [
        ...makeWords(40, { categoryIds: [1] }, 1),
        ...makeWords(40, { categoryIds: [2] }, 101),
        ...makeWords(40, { categoryIds: [3] }, 201),
        ...makeWords(40, { categoryIds: [1, 3] }, 301),
        ...makeWords(40, { locale: "en", categoryIds: [1] }, 401),
    ];
    const byId = new Map(words.map((word) => [word.id, word]));
    const fake = createFakeSource(words);
    const manager = createWordPoolManager({
        source: fake.source,
        poolSize: 7,
        random: mulberry32(12),
    });

    const cases: Array<[string, WordPoolFilters, number]> = [
        ["single category", filters([2]), 40],
        ["parent and subcategory", filters([1, 3]), 120],
        ["category and difficulty", filters([1], [3]), 26],
        ["all categories, two difficulties", filters([], [1, 2]), 108],
        ["english pack", filters([1], [], "en"), 40],
    ];
    for (const [label, poolFilters, eligible] of cases) {
        const room = `R5-${label}`;
        const draws = await drawMany(manager, room, poolFilters, eligible);
        assertNoDuplicates(draws, label);
        for (const id of draws) {
            const word = byId.get(id!);
            assert.ok(word, `${label}: unknown id ${id}`);
            assert.equal(word.locale, poolFilters.locale, label);
            if (poolFilters.difficulties.length > 0) {
                assert.ok(poolFilters.difficulties.includes(word.difficulty), label);
            }
            if (poolFilters.categoryIds.length > 0) {
                assert.ok(
                    word.categoryIds.some((id) => poolFilters.categoryIds.includes(id)),
                    label
                );
            }
        }
    }
});

test("changing filters re-primes instead of serving the stale pool", async () => {
    const words: FakeWord[] = [
        ...makeWords(30, { categoryIds: [1] }, 1),
        ...makeWords(30, { categoryIds: [2] }, 101),
    ];
    const fake = createFakeSource(words);
    const manager = createWordPoolManager({
        source: fake.source,
        poolSize: 10,
        random: mulberry32(13),
    });
    const first = await manager.takeNextId("R6", filters([1]));
    assert.ok(first! <= 30);
    const switched = await drawMany(manager, "R6", filters([2]), 10);
    assert.ok(switched.every((id) => id! > 100), "only category 2 after the switch");
    const back = await drawMany(manager, "R6", filters([1]), 30);
    assertNoDuplicates(back, "fresh state after switching back");
});

test("concurrent draws share one priming scan and never collide", async () => {
    const fake = createFakeSource(makeWords(200), { delayMs: 15 });
    const manager = createWordPoolManager({
        source: fake.source,
        poolSize: 50,
        random: mulberry32(14),
    });
    const draws = await Promise.all(
        Array.from({ length: 20 }, () => manager.takeNextId("R7", filters()))
    );
    assertNoDuplicates(draws, "concurrent draws");
    assert.ok(draws.every((id) => id !== null));
    assert.equal(fake.scans(), 1, "stampede guard");
    assert.equal(manager.size("R7"), 30);

    // Explicit prime callers wait for the same run too.
    const fakeTwo = createFakeSource(makeWords(20), { delayMs: 10 });
    const managerTwo = createWordPoolManager({ source: fakeTwo.source, poolSize: 5 });
    await Promise.all([
        managerTwo.prime("R7b", filters()),
        managerTwo.prime("R7b", filters()),
        managerTwo.prime("R7b", filters()),
    ]);
    assert.equal(fakeTwo.scans(), 1);
    assert.equal(managerTwo.size("R7b"), 5);
});

test("many concurrent draws on a tiny pool all get distinct words", async () => {
    const fake = createFakeSource(makeWords(10), { delayMs: 5 });
    const manager = createWordPoolManager({
        source: fake.source,
        poolSize: 1,
        random: mulberry32(17),
    });
    const draws = await Promise.all(
        Array.from({ length: 6 }, () => manager.takeNextId("R7c", filters()))
    );
    assert.ok(draws.every((id) => id !== null), `null draw in ${draws.join(",")}`);
    assertNoDuplicates(draws, "tiny pool");
});

test("clearing a room during priming drops the stale result", async () => {
    let release!: () => void;
    const gate = new Promise<void>((resolve) => {
        release = resolve;
    });
    const fake = createFakeSource(makeWords(20), { gate });
    const manager = createWordPoolManager({ source: fake.source, poolSize: 5 });

    const pendingPrime = manager.prime("R8", filters());
    manager.clear("R8");
    release();
    await pendingPrime;
    assert.equal(manager.size("R8"), 0, "destroyed room keeps no pool");

    // A draw waiting on a cancelled run primes again and still gets a word.
    let releaseTwo!: () => void;
    const gateTwo = new Promise<void>((resolve) => {
        releaseTwo = resolve;
    });
    const fakeTwo = createFakeSource(makeWords(20), { gate: gateTwo });
    const managerTwo = createWordPoolManager({ source: fakeTwo.source, poolSize: 5 });
    const pendingDraw = managerTwo.takeNextId("R8b", filters());
    managerTwo.clear("R8b");
    releaseTwo();
    assert.notEqual(await pendingDraw, null);
    assert.equal(fakeTwo.scans(), 2);
});

test("discarding the queue re-samples without repeating drawn words", async () => {
    const fake = createFakeSource(makeWords(30));
    const manager = createWordPoolManager({
        source: fake.source,
        poolSize: 10,
        random: mulberry32(15),
    });
    const before = await drawMany(manager, "R9", filters(), 3);
    manager.discardQueue("R9");
    assert.equal(manager.size("R9"), 0);
    const after = await drawMany(manager, "R9", filters(), 27);
    assertNoDuplicates([...before, ...after], "after discard");
    assert.equal(fake.scans(), 4);
});

test("a failing source rejects every waiter and recovers", async () => {
    let failing = true;
    const fake = createFakeSource(makeWords(10), { delayMs: 5, fail: () => failing });
    const manager = createWordPoolManager({ source: fake.source, poolSize: 5 });
    const results = await Promise.allSettled([
        manager.takeNextId("R10", filters()),
        manager.takeNextId("R10", filters()),
    ]);
    assert.ok(results.every((result) => result.status === "rejected"));
    failing = false;
    assert.notEqual(await manager.takeNextId("R10", filters()), null);
});

test("repeated games see different subsets and the whole table", async () => {
    const fake = createFakeSource(makeWords(600));
    const manager = createWordPoolManager({
        source: fake.source,
        poolSize: 120,
        random: mulberry32(16),
    });
    const firstDraws = new Set<string>();
    const seen = new Set<number>();
    for (let game = 0; game < 30; game++) {
        const room = `R11-${game}`;
        const draws = await drawMany(manager, room, filters(), 60);
        assertNoDuplicates(draws, `game ${game}`);
        firstDraws.add(draws.slice(0, 5).join(","));
        draws.forEach((id) => seen.add(id!));
        manager.clear(room);
    }
    assert.equal(firstDraws.size, 30, "every game opens differently");
    assert.ok(seen.size > 500, `only ${seen.size} of 600 words seen across games`);
    assert.ok([...seen].some((id) => id > 500), "words past the old cap appear");
});

// ─── Runner ────────────────────────────────────────────────────

async function main(): Promise<void> {
    for (const [name, run] of tests) {
        await run();
        console.log(`ok - ${name}`);
    }
    console.log(`word pool sampling tests passed (${tests.length})`);
}

main().catch((error) => {
    console.error(error);
    process.exitCode = 1;
});
