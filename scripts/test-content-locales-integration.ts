import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { prisma } from "../apps/web/src/lib/prisma";
import { validateWordCategorySelection } from "../apps/web/src/lib/words/category-assignment-policy";

async function main() {
    const suffix = randomUUID().slice(0, 8);
    const categoryIds: number[] = [];
    const wordIds: number[] = [];

    try {
    const [announcementCount, turkishTranslationCount] = await Promise.all([
        prisma.announcement.count(),
        prisma.announcementTranslation.count({ where: { locale: "tr" } }),
    ]);
    assert.equal(
        turkishTranslationCount >= announcementCount,
        true,
        "Every legacy announcement must have a Turkish translation"
    );

    const [turkishCategory, englishCategory] = await Promise.all([
        prisma.category.create({ data: { name: `Locale TR ${suffix}`, locale: "tr" } }),
        prisma.category.create({ data: { name: `Locale EN ${suffix}`, locale: "en" } }),
    ]);
    categoryIds.push(turkishCategory.id, englishCategory.id);

    const sharedText = `LocaleWord-${suffix}`;
    const [turkishWord, englishWord] = await Promise.all([
        prisma.word.create({ data: { wordText: sharedText, locale: "tr", difficulty: 1 } }),
        prisma.word.create({ data: { wordText: sharedText, locale: "en", difficulty: 1 } }),
    ]);
    wordIds.push(turkishWord.id, englishWord.id);

    const valid = await validateWordCategorySelection([englishCategory.id], "en");
    assert.deepEqual(valid.normalizedCategoryIds, [englishCategory.id]);
    await assert.rejects(
        validateWordCategorySelection([turkishCategory.id], "en"),
        /kendi dilindeki kategorilere/
    );

    console.log("content locale MySQL integration test passed");
    } finally {
        if (wordIds.length > 0) {
            await prisma.word.deleteMany({ where: { id: { in: wordIds } } });
        }
        if (categoryIds.length > 0) {
            await prisma.category.deleteMany({ where: { id: { in: categoryIds } } });
        }
        await prisma.$disconnect();
    }
}

void main();
