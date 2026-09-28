import assert from "node:assert/strict";
import { prisma } from "@hushle/platform-db";
import {
    cleanupFixture,
    FIXTURE_PREFIX,
    FIXTURE_WORD_COUNT,
    getFixtureStatus,
    prepareFixture,
} from "./manage-real-device-smoke-fixture";

async function main(): Promise<void> {
    if (process.env.WEB_LAUNCH_DB_E2E !== "true") {
        console.log(
            "Web real-device fixture integration skipped; WEB_LAUNCH_DB_E2E=true is required."
        );
        return;
    }

    const rawUrl = process.env.DATABASE_URL;
    assert.ok(rawUrl, "DATABASE_URL is required");
    const databaseName = new URL(rawUrl).pathname.replace(/^\/+/, "");
    assert.match(
        databaseName,
        /_test$/,
        "Fixture integration requires a disposable _test database"
    );

    try {
        await cleanupFixture(databaseName);
        await prepareFixture(databaseName);
        await prepareFixture(databaseName);

        const status = await getFixtureStatus(databaseName);
        assert.equal(status.ready, true);
        assert.equal(status.categories, 1);
        assert.equal(status.words, FIXTURE_WORD_COUNT);

        const words = await prisma.word.findMany({
            where: { wordText: { startsWith: FIXTURE_PREFIX } },
            select: {
                tabooWords: { select: { id: true } },
                wordCategories: { select: { categoryId: true } },
            },
        });
        assert.equal(words.length, FIXTURE_WORD_COUNT);
        assert.ok(words.every((word) => word.tabooWords.length === 5));
        assert.ok(words.every((word) => word.wordCategories.length === 1));

        await cleanupFixture(databaseName);
        const cleaned = await getFixtureStatus(databaseName);
        assert.equal(cleaned.ready, false);
        assert.equal(cleaned.categories, 0);
        assert.equal(cleaned.words, 0);
        console.log("Web real-device fixture integration checks passed.");
    } finally {
        await cleanupFixture(databaseName);
        await prisma.$disconnect();
    }
}

main().catch((error) => {
    console.error(error);
    process.exit(1);
});
