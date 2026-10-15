import { prisma } from "@/lib/prisma";
import type { Prisma } from "@hushle/platform-db";
import {
    DEFAULT_GAME_CONTENT_LOCALE,
    type GameContentLocale,
} from "@hushle/domain-game";
import {
    createWordPoolManager,
    normalizeWordPoolFilters,
    parseWordPoolSize,
    type WordIdBatchSource,
    type WordPoolFilters,
    type WordPoolManager,
} from "./word-pool";

// ─── Types ─────────────────────────────────────────────────────
// Matches the CardData interface in @/types/game.ts

interface CardResult {
    id: number;
    word: string;
    difficulty: 1 | 2 | 3;
    taboo: string[];
    categoryColor: string | null;
    locale: GameContentLocale;
}

export interface WordDrawResult {
    card: CardResult;
    analytics: {
        wordId: number;
        categoryIds: number[];
        difficulty: 1 | 2 | 3;
    };
}

// ─── Word Pool per Room ────────────────────────────────────────

const POOL_SIZE = parseWordPoolSize(process.env.WORD_POOL_SIZE);
// A stale id (word deleted or edited by an admin mid-game) is skipped.
const MAX_DRAW_ATTEMPTS = 3;

export function buildEligibleWordWhere(
    filters: WordPoolFilters,
    afterId: number
): Prisma.WordWhereInput {
    const where: Prisma.WordWhereInput = {
        locale: filters.locale,
        id: { gt: afterId },
    };

    if (filters.categoryIds.length > 0) {
        where.wordCategories = {
            some: { categoryId: { in: [...filters.categoryIds] } },
        };
    }

    if (filters.difficulties.length > 0) {
        where.difficulty = { in: [...filters.difficulties] };
    }

    return where;
}

/**
 * Reads eligible ids only, in id order, one batch at a time. The pool samples
 * from the whole stream, so every eligible word is reachable.
 */
export const fetchEligibleWordIdBatch: WordIdBatchSource = async (
    filters,
    afterId,
    limit
) => {
    const words = await prisma.word.findMany({
        where: buildEligibleWordWhere(filters, afterId),
        select: { id: true },
        orderBy: { id: "asc" },
        take: limit,
    });
    return words.map((w) => w.id);
};

const wordPool = createWordPoolManager({
    source: fetchEligibleWordIdBatch,
    poolSize: POOL_SIZE,
});

function toFilters(
    categoryIds: number[],
    difficulties: number[],
    locale: GameContentLocale
): WordPoolFilters {
    return normalizeWordPoolFilters({ locale, categoryIds, difficulties });
}

// ─── Service Functions ─────────────────────────────────────────

/**
 * Sample word IDs by locale, categories and difficulties, shuffled.
 * Concurrent calls for the same room share one priming run.
 */
export async function primeWordPool(
    roomCode: string,
    categoryIds: number[],
    difficulties: number[],
    locale: GameContentLocale = DEFAULT_GAME_CONTENT_LOCALE
): Promise<void> {
    await wordPool.prime(roomCode, toFilters(categoryIds, difficulties, locale));
}

/**
 * Draw the next word from a pool and hydrate it with taboo words.
 * Exported for integration tests that need a custom pool size.
 */
export async function drawWordFromPool(
    pool: WordPoolManager,
    roomCode: string,
    filters: WordPoolFilters
): Promise<WordDrawResult | null> {
    for (let attempt = 0; attempt < MAX_DRAW_ATTEMPTS; attempt++) {
        const wordId = await pool.takeNextId(roomCode, filters);
        if (wordId === null) {
            return null;
        }

        // Hydrate the word
        const word = await prisma.word.findUnique({
            where: { id: wordId },
            include: {
                tabooWords: { select: { tabooWordText: true } },
                wordCategories: {
                    include: { category: { select: { color: true } } },
                },
            },
        });

        const stillEligible =
            word !== null &&
            word.locale === filters.locale &&
            (filters.difficulties.length === 0 ||
                filters.difficulties.includes(word.difficulty)) &&
            (filters.categoryIds.length === 0 ||
                word.wordCategories.some((entry) =>
                    filters.categoryIds.includes(entry.categoryId)
                ));
        if (!word || !stillEligible) {
            // The pool is stale; sample again from the current table.
            pool.discardQueue(roomCode);
            continue;
        }

        const difficulty = word.difficulty as 1 | 2 | 3;
        return {
            card: {
                id: word.id,
                word: word.wordText,
                difficulty,
                taboo: word.tabooWords.map((tw) => tw.tabooWordText),
                categoryColor: word.wordCategories[0]?.category?.color || null,
                locale: filters.locale,
            },
            analytics: {
                wordId: word.id,
                categoryIds: word.wordCategories.map((entry) => entry.categoryId),
                difficulty,
            },
        };
    }

    return null;
}

/**
 * Get the next word from the pool, hydrated with taboo words.
 * If pool is depleted, re-prime it.
 * Returns data matching the CardData interface used by the frontend.
 */
export async function getNextWord(
    roomCode: string,
    categoryIds: number[],
    difficulties: number[],
    locale: GameContentLocale = DEFAULT_GAME_CONTENT_LOCALE
): Promise<WordDrawResult | null> {
    return drawWordFromPool(
        wordPool,
        roomCode,
        toFilters(categoryIds, difficulties, locale)
    );
}

/**
 * Clear the word pool for a room (on game reset).
 */
export function clearWordPool(roomCode: string): void {
    wordPool.clear(roomCode);
}

/**
 * Get word pool stats for a room.
 */
export function getPoolSize(roomCode: string): number {
    return wordPool.size(roomCode);
}
