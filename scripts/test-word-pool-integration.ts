import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import type { GameContentLocale } from "@hushle/domain-game";
import { prisma } from "../apps/web/src/lib/prisma";
import {
    clearWordPool,
    drawWordFromPool,
    fetchEligibleWordIdBatch,
    getNextWord,
    getPoolSize,
    primeWordPool,
} from "../apps/web/src/lib/socket/word-service";
import {
    createWordPoolManager,
    parseWordPoolSize,
    type WordPoolFilters,
} from "../apps/web/src/lib/socket/word-pool";

// Test-only categories and locales; only rows created here are deleted.
const suffix = randomUUID().replaceAll("-", "").slice(0, 6);
const smallLocale = `zs${suffix}` as GameContentLocale;
const largeLocale = `zl${suffix}` as GameContentLocale;
const createdWordIds: number[] = [];
const createdCategoryIds: number[] = [];

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

async function createWord(
    text: string,
    locale: string,
    difficulty: number,
    categoryIds: number[]
): Promise<number> {
    const word = await prisma.word.create({
        data: {
            wordText: text,
            locale,
            difficulty,
            tabooWords: {
                create: [
                    { tabooWordText: `${text}-t1` },
                    { tabooWordText: `${text}-t2` },
                ],
            },
            wordCategories: {
                create: categoryIds.map((categoryId) => ({ categoryId })),
            },
        },
        select: { id: true },
    });
    createdWordIds.push(word.id);
    return word.id;
}

async function main(): Promise<void> {
    assert.equal(
        process.env.WORD_POOL_INTEGRATION_TEST,
        "true",
        "WORD_POOL_INTEGRATION_TEST=true is required"
    );

    try {
        const parent = await prisma.category.create({
            data: { name: `WordPool Parent ${suffix}`, locale: "tr", color: "#123456" },
        });
        const child = await prisma.category.create({
            data: { name: `WordPool Child ${suffix}`, locale: "tr", parentId: parent.id },
        });
        const other = await prisma.category.create({
            data: { name: `WordPool Other ${suffix}`, locale: "tr" },
        });
        createdCategoryIds.push(child.id, parent.id, other.id);

        const parentWords = new Map<number, number>();
        for (let index = 0; index < 30; index++) {
            const difficulty = (index % 3) + 1;
            parentWords.set(
                await createWord(`WPA-${suffix}-${index}`, "tr", difficulty, [parent.id]),
                difficulty
            );
        }
        const childWords = new Map<number, number>();
        for (let index = 0; index < 10; index++) {
            const difficulty = (index % 3) + 1;
            childWords.set(
                await createWord(`WPB-${suffix}-${index}`, "tr", difficulty, [child.id]),
                difficulty
            );
        }
        const englishInParent: number[] = [];
        for (let index = 0; index < 5; index++) {
            englishInParent.push(await createWord(`WPX-${suffix}-${index}`, "en", 2, [parent.id]));
        }
        const otherCategory: number[] = [];
        for (let index = 0; index < 5; index++) {
            otherCategory.push(await createWord(`WPO-${suffix}-${index}`, "tr", 2, [other.id]));
        }
        const smallLocaleIds: number[] = [];
        for (let index = 0; index < 12; index++) {
            smallLocaleIds.push(await createWord(`WPN-${suffix}-${index}`, smallLocale, 1, []));
        }

        await prisma.word.createMany({
            data: Array.from({ length: 600 }, (_, index) => ({
                wordText: `WPL-${suffix}-${index}`,
                locale: largeLocale,
                difficulty: (index % 3) + 1,
            })),
        });
        const largeIds = (
            await prisma.word.findMany({
                where: { locale: largeLocale },
                select: { id: true },
                orderBy: { id: "asc" },
            })
        ).map((word) => word.id);
        createdWordIds.push(...largeIds);
        assert.equal(largeIds.length, 600);

        // 1. The id source walks the table with a cursor, filters applied in SQL.
        const smallFilters: WordPoolFilters = { locale: smallLocale, categoryIds: [], difficulties: [] };
        const sortedSmall = [...smallLocaleIds].sort((a, b) => a - b);
        const firstBatch = await fetchEligibleWordIdBatch(smallFilters, 0, 5);
        assert.deepEqual(firstBatch, sortedSmall.slice(0, 5));
        const secondBatch = await fetchEligibleWordIdBatch(smallFilters, firstBatch[4], 5);
        assert.deepEqual(secondBatch, sortedSmall.slice(5, 10));
        assert.deepEqual(await fetchEligibleWordIdBatch(smallFilters, secondBatch[4], 5), sortedSmall.slice(10));
        assert.deepEqual(await fetchEligibleWordIdBatch(smallFilters, sortedSmall[11], 5), []);
        assert.deepEqual(
            await fetchEligibleWordIdBatch({ ...smallFilters, difficulties: [2, 3] }, 0, 50),
            []
        );
        console.log("ok - id source pages by cursor");

        // 2. Category + locale + difficulty filters, no repeats, card shape.
        const pool = createWordPoolManager({
            source: fetchEligibleWordIdBatch,
            poolSize: 7,
            batchSize: 4,
            random: mulberry32(1),
        });
        const parentFilters: WordPoolFilters = {
            locale: "tr",
            categoryIds: [parent.id],
            difficulties: [1, 2, 3],
        };
        const drawn: number[] = [];
        for (let index = 0; index < 30; index++) {
            const draw = await drawWordFromPool(pool, "WPIT-A", parentFilters);
            assert.ok(draw, "a word is drawn");
            assert.ok(parentWords.has(draw.card.id), `unexpected word ${draw.card.id}`);
            assert.equal(draw.card.locale, "tr");
            assert.equal(draw.card.taboo.length, 2);
            assert.equal(draw.card.categoryColor, "#123456");
            assert.deepEqual(draw.analytics.categoryIds, [parent.id]);
            drawn.push(draw.card.id);
        }
        assert.equal(new Set(drawn).size, 30, "no repeats inside a cycle");
        const nextCycle = await drawWordFromPool(pool, "WPIT-A", parentFilters);
        assert.ok(nextCycle && parentWords.has(nextCycle.card.id));
        assert.notEqual(nextCycle.card.id, drawn[29], "no back-to-back repeat");
        console.log("ok - category, locale and difficulty filters with no repeats");

        // 3. Parent + subcategory with a difficulty filter.
        const mixedFilters: WordPoolFilters = {
            locale: "tr",
            categoryIds: [child.id, parent.id],
            difficulties: [2],
        };
        const expectedMixed = new Set(
            [...parentWords, ...childWords]
                .filter(([, difficulty]) => difficulty === 2)
                .map(([id]) => id)
        );
        const mixedDrawn = new Set<number>();
        for (let index = 0; index < expectedMixed.size; index++) {
            const draw = await drawWordFromPool(pool, "WPIT-B", mixedFilters);
            assert.ok(draw);
            assert.equal(draw.card.difficulty, 2);
            mixedDrawn.add(draw.card.id);
        }
        assert.deepEqual([...mixedDrawn].sort(), [...expectedMixed].sort());
        assert.ok(englishInParent.every((id) => !mixedDrawn.has(id)));
        assert.ok(otherCategory.every((id) => !mixedDrawn.has(id)));
        console.log("ok - subcategory and difficulty filters");

        // 4. Words deleted or moved mid-game are skipped.
        const childFilters: WordPoolFilters = {
            locale: "tr",
            categoryIds: [child.id],
            difficulties: [],
        };
        const first = await drawWordFromPool(pool, "WPIT-C", childFilters);
        assert.ok(first);
        const rest = [...childWords.keys()].filter((id) => id !== first.card.id);
        const deleted = rest.slice(0, 5);
        const moved = rest[5];
        const remaining = new Set(rest.slice(6));
        await prisma.word.deleteMany({ where: { id: { in: deleted } } });
        await prisma.$transaction([
            prisma.wordCategory.deleteMany({ where: { wordId: moved, categoryId: child.id } }),
            prisma.wordCategory.create({ data: { wordId: moved, categoryId: other.id } }),
        ]);
        const afterEdit: number[] = [];
        for (let index = 0; index < remaining.size; index++) {
            const draw = await drawWordFromPool(pool, "WPIT-C", childFilters);
            assert.ok(draw, "stale ids are skipped, not returned as null");
            afterEdit.push(draw.card.id);
        }
        assert.deepEqual([...afterEdit].sort(), [...remaining].sort());
        const cycled = await drawWordFromPool(pool, "WPIT-C", childFilters);
        assert.ok(cycled);
        assert.ok(
            cycled.card.id === first.card.id || remaining.has(cycled.card.id),
            "new cycle only uses words that still match"
        );
        console.log("ok - deleted and re-categorised words are skipped");

        // 5. Every row is reachable on a table larger than the old 500-row cap.
        const largeFilters: WordPoolFilters = { locale: largeLocale, categoryIds: [], difficulties: [] };
        const largePool = createWordPoolManager({
            source: fetchEligibleWordIdBatch,
            poolSize: 120,
            batchSize: 250,
            random: mulberry32(2),
        });
        const tail = new Set(largeIds.slice(500));
        const seen = new Set<number>();
        for (let game = 0; game < 5; game++) {
            const room = `WPIT-L${game}`;
            const ids: number[] = [];
            for (let index = 0; index < 120; index++) {
                const id = await largePool.takeNextId(room, largeFilters);
                assert.ok(id !== null);
                ids.push(id);
                seen.add(id);
            }
            assert.equal(new Set(ids).size, 120);
            assert.ok(ids.some((id) => tail.has(id)), `game ${game} saw no word past the old cap`);
            largePool.clear(room);
        }
        assert.ok(seen.size > 400, `only ${seen.size} distinct words over five games`);
        console.log("ok - words past the old cap are reachable");

        // 6. The exported service API (module pool, env pool size).
        const poolSize = parseWordPoolSize(process.env.WORD_POOL_SIZE);
        const serviceRoom = `WPIT-S${suffix}`;
        const parallel = await Promise.all(
            Array.from({ length: 10 }, () => getNextWord(serviceRoom, [], [], largeLocale))
        );
        assert.ok(parallel.every((draw) => draw !== null));
        assert.equal(new Set(parallel.map((draw) => draw!.card.id)).size, 10);
        assert.ok(parallel.every((draw) => draw!.card.locale === largeLocale));
        assert.equal(getPoolSize(serviceRoom), Math.min(poolSize, 600) - 10);
        clearWordPool(serviceRoom);
        assert.equal(getPoolSize(serviceRoom), 0);

        await primeWordPool(serviceRoom, [parent.id], [1, 2, 3], "tr");
        assert.equal(getPoolSize(serviceRoom), Math.min(poolSize, 30));
        const fromPrimed = await getNextWord(serviceRoom, [parent.id], [1, 2, 3], "tr");
        assert.ok(fromPrimed && parentWords.has(fromPrimed.card.id));
        assert.equal(await getNextWord(`${serviceRoom}-none`, [other.id], [], "en"), null);
        clearWordPool(serviceRoom);
        clearWordPool(`${serviceRoom}-none`);
        console.log("ok - service API");

        console.log("word pool MySQL integration test passed");
    } finally {
        if (createdWordIds.length > 0) {
            await prisma.word.deleteMany({ where: { id: { in: createdWordIds } } });
        }
        if (createdCategoryIds.length > 0) {
            await prisma.category.deleteMany({ where: { id: { in: createdCategoryIds } } });
        }
        await prisma.$disconnect();
    }
}

main().catch((error) => {
    console.error(error);
    process.exitCode = 1;
});
