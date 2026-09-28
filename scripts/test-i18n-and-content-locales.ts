import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dictionaries, translate } from "../apps/web/src/lib/i18n/dictionaries";
import { normalizeAppLocale } from "../apps/web/src/lib/i18n/config";
import {
    announcementTranslationsSchema,
    normalizeRequestedAnnouncementLocale,
} from "../apps/web/src/lib/announcements/localization";
import {
    GAME_CONTENT_LOCALES,
    GAME_CONTENT_LOCALE_DEFINITIONS,
    normalizeGameContentLocale,
} from "@hushle/domain-game";

function leafKeys(value: unknown, prefix = ""): string[] {
    if (!value || typeof value !== "object") return [];
    return Object.entries(value).flatMap(([key, child]) => {
        const path = prefix ? `${prefix}.${key}` : key;
        return typeof child === "string" ? [path] : leafKeys(child, path);
    });
}

assert.deepEqual(leafKeys(dictionaries.en).sort(), leafKeys(dictionaries.tr).sort());
assert.equal(normalizeAppLocale("en"), "en");
assert.equal(normalizeAppLocale("de"), "tr");
assert.equal(normalizeRequestedAnnouncementLocale("en"), "en");
assert.equal(normalizeRequestedAnnouncementLocale("fr"), "tr");
assert.equal(translate("en", "game.round", { current: 2, total: 5 }), "Round 2/5");
assert.deepEqual(GAME_CONTENT_LOCALES, ["tr", "en"]);
assert.equal(GAME_CONTENT_LOCALE_DEFINITIONS.en.intlLocale, "en-US");
assert.equal(normalizeGameContentLocale("en"), "en");
assert.equal(normalizeGameContentLocale("de"), "tr");

const translation = announcementTranslationsSchema.parse({
    tr: {
        title: "Duyuru",
        contentBlocks: [{ type: "paragraph", text: "Türkçe içerik" }],
    },
    en: {
        title: "Announcement",
        contentBlocks: [{ type: "paragraph", text: "English content" }],
    },
});
assert.equal(translation.en?.title, "Announcement");

const schema = readFileSync("prisma/schema.prisma", "utf8");
assert.match(schema, /model AnnouncementTranslation/);
assert.match(schema, /@@unique\(\[announcementId, locale\]\)/);
assert.match(schema, /@@unique\(\[locale, wordText\]\)/);

const moveDeleteRoute = readFileSync(
    "apps/web/src/app/api/admin/categories/[id]/move-delete/route.ts",
    "utf8"
);
assert.match(moveDeleteRoute, /sourceCategory\.locale !== targetCategory\.locale/);

const reorderRoute = readFileSync(
    "apps/web/src/app/api/admin/categories/reorder/route.ts",
    "utf8"
);
assert.match(reorderRoute, /where: \{ locale \}/);

console.log("i18n and content locale contract test passed");
