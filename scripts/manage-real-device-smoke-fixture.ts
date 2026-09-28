import assert from "node:assert/strict";
import { pathToFileURL } from "node:url";
import { prisma } from "@hushle/platform-db";

export const FIXTURE_CATEGORY = "Real Device Smoke [TEMP]";
export const FIXTURE_PREFIX = "real_device_smoke_";
export const FIXTURE_WORD_COUNT = 30;

type FixtureAction = "prepare" | "status" | "cleanup";

function requireSafeDatabase(): string {
    assert.equal(
        process.env.REAL_DEVICE_FIXTURE_ALLOWED,
        "true",
        "REAL_DEVICE_FIXTURE_ALLOWED=true is required"
    );

    const rawUrl = process.env.DATABASE_URL;
    assert.ok(rawUrl, "DATABASE_URL is required");
    const databaseUrl = new URL(rawUrl);
    const databaseName = databaseUrl.pathname.replace(/^\/+/, "");

    assert.equal(databaseUrl.protocol, "mysql:", "A MySQL database is required");
    assert.match(
        databaseName,
        /(?:_dev|_test)$/,
        "The database name must end with _dev or _test"
    );

    return databaseName;
}

function parseAction(value: string | undefined): FixtureAction {
    if (value === "prepare" || value === "status" || value === "cleanup") {
        return value;
    }
    throw new Error("Usage: npm run smoke:web-real-device-fixture -- prepare|status|cleanup");
}

export async function getFixtureStatus(databaseName: string) {
    const [categories, words] = await Promise.all([
        prisma.category.count({ where: { name: FIXTURE_CATEGORY } }),
        prisma.word.count({
            where: { wordText: { startsWith: FIXTURE_PREFIX } },
        }),
    ]);

    return {
        databaseName,
        category: FIXTURE_CATEGORY,
        categories,
        words,
        expectedWords: FIXTURE_WORD_COUNT,
        ready: categories === 1 && words === FIXTURE_WORD_COUNT,
    };
}

export async function prepareFixture(databaseName: string): Promise<void> {
    let category = await prisma.category.findFirst({
        where: { name: FIXTURE_CATEGORY },
        orderBy: { id: "asc" },
        select: { id: true },
    });

    if (!category) {
        category = await prisma.category.create({
            data: {
                name: FIXTURE_CATEGORY,
                color: "#0f766e",
                sortOrder: 999_000,
                isVisible: true,
            },
            select: { id: true },
        });
    }

    for (let index = 1; index <= FIXTURE_WORD_COUNT; index += 1) {
        const suffix = String(index).padStart(2, "0");
        const wordText = `${FIXTURE_PREFIX}${suffix}`;
        const word = await prisma.word.upsert({
            where: {
                locale_wordText: {
                    locale: "tr",
                    wordText,
                },
            },
            create: {
                wordText,
                locale: "tr",
                difficulty: ((index - 1) % 3) + 1,
            },
            update: {
                difficulty: ((index - 1) % 3) + 1,
            },
            select: { id: true },
        });

        await prisma.$transaction([
            prisma.tabooWord.deleteMany({ where: { wordId: word.id } }),
            prisma.tabooWord.createMany({
                data: Array.from({ length: 5 }, (_, tabooIndex) => ({
                    wordId: word.id,
                    tabooWordText: `yasak_${suffix}_${tabooIndex + 1}`,
                })),
            }),
            prisma.wordCategory.upsert({
                where: {
                    wordId_categoryId: {
                        wordId: word.id,
                        categoryId: category.id,
                    },
                },
                create: {
                    wordId: word.id,
                    categoryId: category.id,
                },
                update: {},
            }),
        ]);
    }

    console.log(JSON.stringify(await getFixtureStatus(databaseName), null, 2));
}

export async function cleanupFixture(databaseName: string): Promise<void> {
    const deletedWords = await prisma.word.deleteMany({
        where: { wordText: { startsWith: FIXTURE_PREFIX } },
    });
    const deletedCategories = await prisma.category.deleteMany({
        where: { name: FIXTURE_CATEGORY },
    });

    console.log(
        JSON.stringify(
            {
                databaseName,
                deletedWords: deletedWords.count,
                deletedCategories: deletedCategories.count,
            },
            null,
            2
        )
    );
}

async function main(): Promise<void> {
    const action = parseAction(process.argv[2]);
    const databaseName = requireSafeDatabase();

    try {
        if (action === "prepare") {
            await prepareFixture(databaseName);
            return;
        }
        if (action === "cleanup") {
            await cleanupFixture(databaseName);
            return;
        }
        console.log(JSON.stringify(await getFixtureStatus(databaseName), null, 2));
    } finally {
        await prisma.$disconnect();
    }
}

const entryPath = process.argv[1];
if (entryPath && import.meta.url === pathToFileURL(entryPath).href) {
    main().catch((error) => {
        console.error(error);
        process.exit(1);
    });
}
