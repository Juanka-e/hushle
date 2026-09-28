import assert from "node:assert/strict";
import {
    ANNOUNCEMENT_MEDIA_URL_MAX_LENGTH,
    sanitizeAnnouncementContent,
    sanitizeAnnouncementMedia,
} from "../apps/web/src/lib/security/announcements";

const maliciousHtml = `
    <p onclick="alert(1)">Safe text</p>
    <script>alert('xss')</script>
    <a href="javascript:alert(2)">bad link</a>
    <a href="https://example.com/docs">good link</a>
    <img src="data:text/html;base64,AAAA" onerror="alert(3)" />
    <img src="/cosmetics/mock/avatars/pulse-fox.svg" />
`;

const sanitizedHtml = sanitizeAnnouncementContent(maliciousHtml);
assert.equal(sanitizedHtml.includes("<script"), false);
assert.equal(sanitizedHtml.includes("onclick"), false);
assert.equal(sanitizedHtml.includes("javascript:"), false);
assert.equal(sanitizedHtml.includes("onerror"), false);
assert.equal(sanitizedHtml.includes('href="https://example.com/docs"'), true);
assert.equal(sanitizedHtml.includes("data:text/html"), false);
assert.equal(sanitizedHtml.includes("/cosmetics/mock/avatars/pulse-fox.svg"), false);

const safeYoutube = sanitizeAnnouncementMedia("https://youtu.be/abc123xyz89", "youtube");
assert.equal(safeYoutube.mediaUrl, "https://www.youtube.com/embed/abc123xyz89");
assert.equal(safeYoutube.mediaType, "youtube");

const unsafeYoutube = sanitizeAnnouncementMedia("http://evil.example/video", "youtube");
assert.equal(unsafeYoutube.mediaUrl, null);
assert.equal(unsafeYoutube.mediaType, null);

const malformedYoutube = sanitizeAnnouncementMedia(
    "https://www.youtube.com/embed/abc123/../../tracking",
    "youtube"
);
assert.equal(malformedYoutube.mediaUrl, null);

const oversizedMediaUrl = sanitizeAnnouncementMedia(
    `https://cdn.example.com/${"a".repeat(ANNOUNCEMENT_MEDIA_URL_MAX_LENGTH)}.png`,
    "image"
);
assert.equal(oversizedMediaUrl.mediaUrl, null);

const safeImage = sanitizeAnnouncementMedia("/cosmetics/mock/card-faces/ember-glow.svg", "image");
assert.equal(safeImage.mediaUrl, null);
assert.equal(safeImage.mediaType, null);

const safeRemoteImage = sanitizeAnnouncementMedia("https://cdn.example.com/banner.webp", "image");
assert.equal(safeRemoteImage.mediaUrl, "https://cdn.example.com/banner.webp");
assert.equal(safeRemoteImage.mediaType, "image");

console.log("announcement security smoke test passed");
