import { prisma } from "../apps/web/src/lib/prisma";
import {
    MAX_BULK_WORD_UPLOAD_ROWS,
    processBulkWordUpload,
} from "../apps/web/src/lib/admin-words-bulk-upload/service";

async function main() {
    const oversizedResult = await processBulkWordUpload({
        text: Array.from(
            { length: MAX_BULK_WORD_UPLOAD_ROWS + 1 },
            (_, index) => `limit-test-${index},1,yasak`
        ).join("\n"),
        mode: "fixed_categories",
    });
    if (
        !("error" in oversizedResult) ||
        typeof oversizedResult.error !== "string" ||
        !oversizedResult.error.includes("1000")
    ) {
        throw new Error("Bulk row limit was not enforced.");
    }

    const rootName = `Test Bulk Kategori ${Date.now()}`;
    const childName = "Alt Paket";
    const fixedRootName = `Test Bulk Sabit ${Date.now()}`;

    const rootCategory = await prisma.category.create({
        data: {
            name: rootName,
            color: "#3B82F6",
            sortOrder: 9990,
            isVisible: true,
        },
    });

    const childCategory = await prisma.category.create({
        data: {
            name: childName,
            parentId: rootCategory.id,
            color: "#60A5FA",
            sortOrder: 9991,
            isVisible: true,
        },
    });

    const fixedCategory = await prisma.category.create({
        data: {
            name: fixedRootName,
            color: "#10B981",
            sortOrder: 9992,
            isVisible: true,
        },
    });

    const existingWord = await prisma.word.create({
        data: {
            wordText: `test-bulk-duplicate-${Date.now()}`,
            difficulty: 1,
            tabooWords: {
                create: [{ tabooWordText: "hazir" }],
            },
            wordCategories: {
                create: [{ categoryId: rootCategory.id }],
            },
        },
    });

    const csvModeText = [
        "kelime,zorluk,kategori,alt_kategori,yasak1,yasak2",
        `${existingWord.wordText},1,${rootName},,tekrar,eski`,
        `test-bulk-yeni-${Date.now()},2,${rootName},${childName},yasak-a,yasak-b`,
        `test-bulk-hata-${Date.now()},4,${rootName},,yasak-a`,
    ].join("\n");

    const csvModeResult = await processBulkWordUpload({
        text: csvModeText,
        mode: "csv_categories",
    });

    if ("error" in csvModeResult) {
        throw new Error(`csv_categories failed: ${csvModeResult.error}`);
    }

    const fixedModeWord = `test-bulk-fixed-${Date.now()}`;
    const fixedModeText = [
        "kelime,zorluk,yasak1,yasak2",
        `${fixedModeWord},3,gece,pazar`,
    ].join("\n");

    const fixedModeResult = await processBulkWordUpload({
        text: fixedModeText,
        mode: "fixed_categories",
        categoryIdValue: String(fixedCategory.id),
    });

    if ("error" in fixedModeResult) {
        throw new Error(`fixed_categories failed: ${fixedModeResult.error}`);
    }

    const insertedCsvWord = await prisma.word.findUnique({
        where: {
            locale_wordText: {
                locale: "tr",
                wordText: csvModeText.split("\n")[2].split(",")[0],
            },
        },
        include: {
            wordCategories: true,
            tabooWords: true,
        },
    });

    const insertedFixedWord = await prisma.word.findUnique({
        where: {
            locale_wordText: { locale: "tr", wordText: fixedModeWord },
        },
        include: {
            wordCategories: true,
            tabooWords: true,
        },
    });

    console.log(
        JSON.stringify(
            {
                csvMode: csvModeResult.results,
                fixedMode: fixedModeResult.results,
                insertedCsvWord: insertedCsvWord
                    ? {
                        wordText: insertedCsvWord.wordText,
                        categoryIds: insertedCsvWord.wordCategories.map((entry) => entry.categoryId),
                        tabooWords: insertedCsvWord.tabooWords.map((entry) => entry.tabooWordText),
                    }
                    : null,
                insertedFixedWord: insertedFixedWord
                    ? {
                        wordText: insertedFixedWord.wordText,
                        categoryIds: insertedFixedWord.wordCategories.map((entry) => entry.categoryId),
                        tabooWords: insertedFixedWord.tabooWords.map((entry) => entry.tabooWordText),
                    }
                    : null,
            },
            null,
            2
        )
    );

    await prisma.word.deleteMany({
        where: {
            wordText: {
                in: [existingWord.wordText, fixedModeWord, csvModeText.split("\n")[2].split(",")[0]],
            },
        },
    });

    await prisma.category.deleteMany({
        where: {
            id: { in: [childCategory.id, rootCategory.id, fixedCategory.id] },
        },
    });
}

main()
    .catch((error) => {
        console.error("Bulk upload smoke test failed:", error);
        process.exit(1);
    })
    .finally(async () => {
        await prisma.$disconnect();
    });
