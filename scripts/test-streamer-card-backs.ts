import assert from "node:assert/strict";
import { createStreamSession, publicSnapshot, type StreamCardBack, type StreamScreenSettings } from "@hushle/domain-streamer";
import { readSnapshot } from "../apps/web/src/components/stream/stream-renderer";
import { resolveCardBackTheme } from "../apps/web/src/lib/cosmetics/card-back";
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

// The owned card back as the inventory carries it (the render snapshot the player bought).
const OWNED_KOR = {
    shopItemId: 10,
    name: "Kor",
    type: "card_back",
    rarity: "rare",
    renderMode: "template",
    renderSpecVersion: 1,
    imageUrl: "/cosmetics/item-10.svg",
    thumbnailUrl: null,
    templateKey: "ember",
    templateConfig: { surfaceColor: "#102030", borderColor: "#405060", pattern: "grid" },
} as const;

function loaders(equippedId: number | null = 10, catalog: CardBackCatalogItem[] = CATALOG): CardBackLoaders & { catalogCalls: number } {
    const inventory: CardBackInventory = {
        profile: { cardBackItemId: equippedId },
        items: [
            { ...OWNED_KOR, templateConfig: { ...OWNED_KOR.templateConfig } },
            { shopItemId: 20, name: "Avatar", type: "avatar", rarity: "common", renderMode: "image", renderSpecVersion: 1, imageUrl: "/a.svg", thumbnailUrl: null, templateKey: null, templateConfig: null },
        ],
    };
    const counted = {
        catalogCalls: 0,
        inventory: async () => inventory,
        catalog: async () => {
            counted.catalogCalls += 1;
            return catalog;
        },
        now: () => Date.parse("2026-11-05T12:00:00Z"),
    };
    return counted;
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

    await test("selection: the owned item resolves to exactly its own theme, name and image", async () => {
        const back = await resolveCardBackSelection(1, 10, { streamerShowcaseAllCosmetics: false }, loaders());
        const theme = resolveCardBackTheme({ ...OWNED_KOR, templateConfig: { ...OWNED_KOR.templateConfig } });
        assert.deepEqual(back, { itemId: 10, name: "Kor", theme, imageUrl: "/cosmetics/item-10.svg" });
        // The template config reached the theme, not the rarity defaults.
        assert.equal(back.theme.surfaceColor, "#102030");
        assert.equal(back.theme.borderColor, "#405060");
        assert.equal(back.theme.pattern, "grid");
        assert.equal(back.theme.overlayImageUrl, null, "a template card back has no overlay image");
    });

    await test("selection: an owned item never reads the catalogue; its own render snapshot wins over the catalogue copy", async () => {
        // The catalogue copy of item 10 has changed since it was bought.
        const changed = CATALOG.map((entry) => (entry.id === 10 ? { ...entry, name: "Kor (yeni)", templateConfig: { surfaceColor: "#999999" } } : entry));
        for (const showcase of [false, true]) {
            const counted = loaders(10, changed);
            const back = await resolveCardBackSelection(1, 10, { streamerShowcaseAllCosmetics: showcase }, counted);
            assert.equal(counted.catalogCalls, 0, `showcase ${showcase}: the catalogue is not fetched for an owned item`);
            assert.equal(back.name, "Kor");
            assert.equal(back.theme.surfaceColor, "#102030");
        }
        // A non-owned item still needs the catalogue (switch on).
        const counted = loaders(10, changed);
        const buz = await resolveCardBackSelection(1, 11, { streamerShowcaseAllCosmetics: true }, counted);
        assert.equal(counted.catalogCalls, 1);
        assert.deepEqual(buz, {
            itemId: 11,
            name: "Buz",
            theme: resolveCardBackTheme({ ...item(11, "card_back") }),
            imageUrl: "/cosmetics/item-11.svg",
        });
        // Switch off: a non-owned item is refused without reading the catalogue.
        const off = loaders(10, changed);
        await rejects(() => resolveCardBackSelection(1, 11, { streamerShowcaseAllCosmetics: false }, off));
        assert.equal(off.catalogCalls, 0);
    });

    await test("selection: a non-owned item needs the switch, an avatar or inactive item never works", async () => {
        await rejects(() => resolveCardBackSelection(1, 11, { streamerShowcaseAllCosmetics: false }, loaders()));
        const back = await resolveCardBackSelection(1, 11, { streamerShowcaseAllCosmetics: true }, loaders());
        assert.equal(back.itemId, 11);
        await rejects(() => resolveCardBackSelection(1, 20, { streamerShowcaseAllCosmetics: true }, loaders()));
        await rejects(() => resolveCardBackSelection(1, 13, { streamerShowcaseAllCosmetics: true }, loaders()));
        await rejects(() => resolveCardBackSelection(1, 14, { streamerShowcaseAllCosmetics: true }, loaders()));
        await rejects(() => resolveCardBackSelection(1, 15, { streamerShowcaseAllCosmetics: true }, loaders()));
        const sezon = await resolveCardBackSelection(1, 16, { streamerShowcaseAllCosmetics: true }, loaders());
        assert.deepEqual([sezon.itemId, sezon.name, sezon.imageUrl], [16, "Sezon", "/cosmetics/item-16.svg"]);
        await rejects(() => resolveCardBackSelection(1, 999, { streamerShowcaseAllCosmetics: true }, loaders()));
    });

    await test("availability window fails closed: a bound that does not parse makes the item unavailable", async () => {
        const broken = [
            ...CATALOG,
            item(17, "card_back", { name: "Bozuk baslangic", startsAt: "not a date" }),
            item(18, "card_back", { name: "Bozuk bitis", endsAt: "2026-13-45T99:00:00Z" }),
            item(19, "card_back", { name: "Bos", startsAt: "", endsAt: null }),
            item(21, "card_back", { name: "Acik", startsAt: null, endsAt: null }),
        ];
        const options = await listCardBacksForUser(1, { streamerShowcaseAllCosmetics: true }, loaders(10, broken));
        assert.deepEqual(options.map((o) => o.itemId), [10, 11, 12, 16, 21]);
        for (const id of [17, 18, 19]) await rejects(() => resolveCardBackSelection(1, id, { streamerShowcaseAllCosmetics: true }, loaders(10, broken)));
        assert.equal((await resolveCardBackSelection(1, 21, { streamerShowcaseAllCosmetics: true }, loaders(10, broken))).name, "Acik");
    });

    await test("the window is judged by the caller clock, on both sides of each edge (edges included)", async () => {
        const opens = Date.parse("2026-12-01T00:00:00Z"); // item 14 starts
        const closes = Date.parse("2026-10-01T00:00:00Z"); // item 15 ended
        const on = { streamerShowcaseAllCosmetics: true };
        // The loaders carry a clock of their own (2026-11-05): the explicit clock wins over it.
        await rejects(() => resolveCardBackSelection(1, 14, on, loaders(), () => opens - 1));
        assert.equal((await resolveCardBackSelection(1, 14, on, loaders(), () => opens)).itemId, 14);
        assert.equal((await resolveCardBackSelection(1, 15, on, loaders(), () => closes)).itemId, 15);
        await rejects(() => resolveCardBackSelection(1, 15, on, loaders(), () => closes + 1));
        // Loaders without a clock: the explicit one is the only time read.
        const clockless: CardBackLoaders = { inventory: loaders().inventory, catalog: loaders().catalog };
        assert.equal((await resolveCardBackSelection(1, 14, on, clockless, () => opens + 1)).itemId, 14);
        await rejects(() => resolveCardBackSelection(1, 14, on, clockless, () => opens - 1));
        // The option list takes the same clock.
        assert.ok((await listCardBacksForUser(1, on, loaders(), () => opens)).some((o) => o.itemId === 14));
        assert.ok(!(await listCardBacksForUser(1, on, loaders(), () => opens - 1)).some((o) => o.itemId === 14));
    });

    await test("the public projection is what the stream screen draws: the screen's own allowlist changes nothing", async () => {
        const template = await resolveCardBackSelection(1, 10, { streamerShowcaseAllCosmetics: false }, loaders());
        const imageCatalog = [...CATALOG, item(30, "card_back", { name: "Resim", renderMode: "image", imageUrl: "https://cdn.hushle.example/backs/resim.png" })];
        const image = await resolveCardBackSelection(1, 30, { streamerShowcaseAllCosmetics: true }, loaders(10, imageCatalog));
        assert.equal(image.theme.overlayImageUrl, "https://cdn.hushle.example/backs/resim.png");
        const hostile = {
            itemId: 4,
            name: "Kor",
            imageUrl: "//evil.example/x.png",
            theme: { ...template.theme, surfaceColor: "red", patternScale: 900, pattern: "<b>", motionSpeedMs: -1, overlayImageUrl: "javascript:x", glowOpacity: 9, extra: 1 },
        } as unknown as StreamCardBack;
        for (const cardBack of [template, image, hostile]) {
            const settings: StreamScreenSettings = {
                theme: "studyo", camera: "none", cameraSize: "m", clock: null, cardBack, showCardName: false, duration: 60, language: "tr", tolerance: "normal", channel: null,
            };
            const sent = publicSnapshot(createStreamSession(settings, 0), 1);
            assert.ok(sent.cardBack, `item ${cardBack.itemId} is sent`);
            const drawn = readSnapshot(JSON.parse(JSON.stringify(sent)));
            // The screen keeps the fields it draws; each one arrives exactly as the server bounded it.
            const { renderSpecVersion, requestedRenderSpecVersion, usedRenderSpecFallback, detailColor, ...drawnFields } = sent.cardBack.theme;
            void [renderSpecVersion, requestedRenderSpecVersion, usedRenderSpecFallback, detailColor];
            assert.deepEqual(drawn?.cardBack, { itemId: sent.cardBack.itemId, name: sent.cardBack.name, theme: drawnFields }, `item ${cardBack.itemId}`);
        }
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
        const unavailable = (e: unknown) => isStreamerSessionError(e) && e.code === "card_catalogue_unavailable";
        for (const broken of [{ ...loaders(), inventory: boom }, { ...loaders(), catalog: boom }]) {
            await assert.rejects(() => listCardBacksForUser(1, { streamerShowcaseAllCosmetics: true }, broken), unavailable);
            await assert.rejects(() => resolveCardBackSelection(1, 11, { streamerShowcaseAllCosmetics: true }, broken), unavailable);
        }
        // The inventory is always read; the catalogue only for an item the streamer does not own.
        await assert.rejects(() => resolveCardBackSelection(1, 10, { streamerShowcaseAllCosmetics: true }, { ...loaders(), inventory: boom }), unavailable);
        const owned = await resolveCardBackSelection(1, 10, { streamerShowcaseAllCosmetics: true }, { ...loaders(), catalog: boom });
        assert.equal(owned.itemId, 10);
    });

    console.log(`${count} checks passed.`);
}

main().catch((error) => {
    console.error(error);
    process.exit(1);
});
