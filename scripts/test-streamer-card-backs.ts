import assert from "node:assert/strict";
import {
    listCardBacksForUser,
    resolveCardBackSelection,
    type CardBackCatalogItem,
    type CardBackInventory,
    type CardBackLoaders,
} from "../apps/web/src/lib/streamer/card-backs";
import { isStreamerSessionError } from "../apps/web/src/lib/streamer/session-runtime";

// Streamer card-back catalogue (phase 2, Task 4b): owned-only by default, the whole catalogue
// when the showcase switch is on. Fake inventory and catalogue, no database.

let count = 0;
async function test(name: string, run: () => Promise<void> | void): Promise<void> {
    await run();
    count += 1;
    console.log(`PASS ${name}`);
}

function item(id: number, type: string, overrides: Partial<CardBackCatalogItem> = {}): CardBackCatalogItem {
    return {
        id,
        name: `Item ${id}`,
        type,
        rarity: "rare",
        renderMode: "template",
        renderSpecVersion: 1,
        imageUrl: `/cosmetics/item-${id}.svg`,
        thumbnailUrl: `/cosmetics/item-${id}-thumb.svg`,
        templateKey: "ember",
        templateConfig: { surfaceColor: "#102030", borderColor: "#405060", pattern: "grid" },
        isActive: true,
        startsAt: null,
        endsAt: null,
        ...overrides,
    };
}

const CATALOG: CardBackCatalogItem[] = [
    item(10, "card_back", { name: "Kor" }),
    item(11, "card_back", { name: "Buz" }),
    item(12, "card_back", { name: "Orman" }),
    item(20, "avatar", { name: "Avatar" }),
    item(13, "card_back", { name: "Gizli", isActive: false }),
    item(14, "card_back", { name: "Yakinda", startsAt: "2026-12-01T00:00:00Z" }),
    item(15, "card_back", { name: "Bitti", endsAt: "2026-10-01T00:00:00Z" }),
    item(16, "card_back", { name: "Sezon", startsAt: "2026-10-01T00:00:00Z", endsAt: "2026-12-01T00:00:00Z" }),
];

function loaders(equippedId: number | null = 10): CardBackLoaders {
    const inventory: CardBackInventory = {
        profile: { cardBackItemId: equippedId },
        items: [
            { shopItemId: 10, name: "Kor", type: "card_back", rarity: "rare", renderMode: "template", renderSpecVersion: 1, imageUrl: "/cosmetics/item-10.svg", thumbnailUrl: null, templateKey: "ember", templateConfig: { surfaceColor: "#102030", borderColor: "#405060", pattern: "grid" } },
            { shopItemId: 20, name: "Avatar", type: "avatar", rarity: "common", renderMode: "image", renderSpecVersion: 1, imageUrl: "/a.svg", thumbnailUrl: null, templateKey: null, templateConfig: null },
        ],
    };
    return { inventory: async () => inventory, catalog: async () => CATALOG, now: () => Date.parse("2026-11-05T12:00:00Z") };
}

async function rejects(run: () => Promise<unknown>): Promise<void> {
    await assert.rejects(run, (error: unknown) => {
        assert.ok(isStreamerSessionError(error));
        assert.equal(error.code, "card_not_allowed");
        return true;
    });
}

async function main(): Promise<void> {
    await test("switch off: only the owned card back is selectable", async () => {
        const options = await listCardBacksForUser(1, { streamerShowcaseAllCosmetics: false }, loaders());
        assert.deepEqual(options.map((o) => o.itemId), [10]);
        assert.deepEqual([options[0].owned, options[0].selectable, options[0].equipped], [true, true, true]);
    });

    await test("switch on: every active catalogue card back is selectable, avatars never listed", async () => {
        const options = await listCardBacksForUser(1, { streamerShowcaseAllCosmetics: true }, loaders());
        assert.deepEqual(options.map((o) => o.itemId).sort(), [10, 11, 12, 16]);
        assert.ok(options.every((o) => o.selectable));
        assert.deepEqual(options.map((o) => [o.itemId, o.owned, o.equipped]).sort(), [[10, true, true], [11, false, false], [12, false, false], [16, false, false]]);
        assert.ok(!options.some((o) => o.itemId === 20 || o.itemId === 13));
        const kor = options.find((o) => o.itemId === 10)!;
        assert.equal(kor.preview.renderMode, "template");
        assert.equal(kor.preview.rarity, "rare");
        assert.equal(options.find((o) => o.itemId === 11)!.preview.thumbnailUrl, "/cosmetics/item-11-thumb.svg");
    });

    await test("nothing equipped: no option is flagged equipped", async () => {
        const options = await listCardBacksForUser(1, { streamerShowcaseAllCosmetics: true }, loaders(null));
        assert.ok(options.every((o) => !o.equipped));
    });

    await test("selection: the owned item resolves with a public theme", async () => {
        const back = await resolveCardBackSelection(1, 10, { streamerShowcaseAllCosmetics: false }, loaders());
        assert.equal(back.itemId, 10);
        assert.equal(back.name, "Kor");
        assert.equal(typeof back.theme.surfaceColor, "string");
        assert.equal(typeof back.theme.borderColor, "string");
        assert.equal(typeof back.theme.pattern, "string");
        assert.equal(back.imageUrl, "/cosmetics/item-10.svg");
    });

    await test("selection: a non-owned item needs the switch, an avatar or inactive item never works", async () => {
        await rejects(() => resolveCardBackSelection(1, 11, { streamerShowcaseAllCosmetics: false }, loaders()));
        const back = await resolveCardBackSelection(1, 11, { streamerShowcaseAllCosmetics: true }, loaders());
        assert.equal(back.itemId, 11);
        await rejects(() => resolveCardBackSelection(1, 20, { streamerShowcaseAllCosmetics: true }, loaders()));
        await rejects(() => resolveCardBackSelection(1, 13, { streamerShowcaseAllCosmetics: true }, loaders()));
        await rejects(() => resolveCardBackSelection(1, 14, { streamerShowcaseAllCosmetics: true }, loaders()));
        await rejects(() => resolveCardBackSelection(1, 15, { streamerShowcaseAllCosmetics: true }, loaders()));
        assert.equal((await resolveCardBackSelection(1, 16, { streamerShowcaseAllCosmetics: true }, loaders())).itemId, 16);
        await rejects(() => resolveCardBackSelection(1, 999, { streamerShowcaseAllCosmetics: true }, loaders()));
    });

    await test("the resolved theme and the option list carry no account data", async () => {
        const options = await listCardBacksForUser(1, { streamerShowcaseAllCosmetics: true }, loaders());
        const text = JSON.stringify(options) + JSON.stringify(await resolveCardBackSelection(1, 10, { streamerShowcaseAllCosmetics: true }, loaders()));
        assert.ok(!/inventoryItemId|userId|email|priceCoin/.test(text));
    });

    await test("a failing loader maps to card_catalogue_unavailable", async () => {
        const boom = async () => {
            throw new Error("db down");
        };
        for (const broken of [{ ...loaders(), inventory: boom }, { ...loaders(), catalog: boom }]) {
            await assert.rejects(() => listCardBacksForUser(1, { streamerShowcaseAllCosmetics: true }, broken), (e: unknown) => isStreamerSessionError(e) && e.code === "card_catalogue_unavailable");
            await assert.rejects(() => resolveCardBackSelection(1, 10, { streamerShowcaseAllCosmetics: true }, broken), (e: unknown) => isStreamerSessionError(e) && e.code === "card_catalogue_unavailable");
        }
    });

    console.log(`${count} checks passed.`);
}

main().catch((error) => {
    console.error(error);
    process.exit(1);
});
