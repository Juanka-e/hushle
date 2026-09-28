import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { randomUUID } from "node:crypto";
import { resolve } from "node:path";
import { prisma } from "../apps/web/src/lib/prisma";

async function run(): Promise<void> {
    if (process.env.WEB_LAUNCH_DB_E2E !== "true") {
        console.log(
            "Web multiplayer launch test skipped; WEB_LAUNCH_DB_E2E=true is required."
        );
        return;
    }

    assert.match(
        process.env.DATABASE_URL ?? "",
        /tabu_test/,
        "Web multiplayer launch test requires a disposable tabu_test database"
    );

    const suffix = randomUUID().replaceAll("-", "").slice(0, 12);
    const wordPrefix = `multiplayer_${suffix}_`;
    let categoryId: number | null = null;

    try {
        const category = await prisma.category.create({
            data: {
                name: `Multiplayer Smoke ${suffix}`,
                color: "#0f766e",
                sortOrder: 999_000,
                isVisible: true,
            },
            select: { id: true },
        });
        categoryId = category.id;

        for (let index = 1; index <= 4; index += 1) {
            const word = await prisma.word.create({
                data: {
                    wordText: `${wordPrefix}${index}`,
                    difficulty: 1,
                    tabooWords: {
                        create: [
                            { tabooWordText: `taboo_${suffix}_${index}_a` },
                            { tabooWordText: `taboo_${suffix}_${index}_b` },
                        ],
                    },
                },
                select: { id: true },
            });
            await prisma.wordCategory.create({
                data: {
                    wordId: word.id,
                    categoryId,
                },
            });
        }

        const playwrightCli = resolve(
            "node_modules",
            "@playwright",
            "test",
            "cli.js"
        );
        const result = spawnSync(
            process.execPath,
            [
                playwrightCli,
                "test",
                "--config=playwright.multiplayer.config.ts",
            ],
            {
                cwd: process.cwd(),
                env: {
                    ...process.env,
                    WEB_MULTIPLAYER_E2E: "true",
                    ROOM_JOIN_MAX_ATTEMPTS:
                        process.env.WEB_MULTIPLAYER_ROOM_JOIN_MAX_ATTEMPTS ??
                        "100",
                },
                stdio: "inherit",
            }
        );

        if (result.status !== 0) {
            throw new Error(
                `Web multiplayer Playwright suite failed with status ${result.status}`
            );
        }
    } finally {
        await prisma.word.deleteMany({
            where: { wordText: { startsWith: wordPrefix } },
        });
        if (categoryId !== null) {
            await prisma.category.deleteMany({ where: { id: categoryId } });
        }
        await prisma.$disconnect();
    }
}

run().catch((error) => {
    console.error(error);
    process.exit(1);
});
