import assert from "node:assert/strict";
import {
    announcementBlocksSchema,
    announcementBlocksToHtml,
    announcementBlocksToPreview,
    normalizeAnnouncementBlocks,
} from "../apps/web/src/lib/announcements/content";

const sampleBlocks = announcementBlocksSchema.parse([
    { type: "heading", text: "Sistem guncellemesi", level: 2 },
    { type: "paragraph", text: "Sirali duyuru metni guvenli bloklarla kaydedilir." },
    { type: "bullet_list", items: ["Madde bir", "Madde iki"] },
    { type: "divider" },
    { type: "quote", text: "Bu bir ornek alintidir." },
]);

const html = announcementBlocksToHtml(sampleBlocks);
assert.equal(html.includes("<script"), false);
assert.equal(html.includes("onclick"), false);
assert.equal(html.includes("<h2>Sistem guncellemesi</h2>"), true);

const preview = announcementBlocksToPreview(sampleBlocks);
assert.equal(preview, "Sistem guncellemesi");
const listPreview = announcementBlocksToPreview([
    { type: "bullet_list", items: ["Madde bir", "Madde iki"] },
]);
assert.equal(listPreview.includes("Madde bir"), true);
assert.equal(listPreview.includes("•"), true);

const normalizedFromLegacy = normalizeAnnouncementBlocks(
    null,
    "<h2>Baslik</h2><p>Merhaba dunya</p><ul><li>Ilk</li><li>Ikinci</li></ul>"
);

assert.equal(normalizedFromLegacy[0]?.type, "heading");
assert.equal(normalizedFromLegacy.some((block) => block.type === "bullet_list"), true);

console.log("announcement structure smoke test passed");
