import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";

const TEXT_EXTENSIONS = new Set([
    ".css",
    ".env",
    ".example",
    ".html",
    ".js",
    ".json",
    ".jsx",
    ".md",
    ".prisma",
    ".scss",
    ".sh",
    ".ts",
    ".tsx",
    ".txt",
    ".yaml",
    ".yml",
]);
const TEXT_BASENAMES = new Set([
    ".editorconfig",
    ".gitattributes",
    ".gitignore",
    "Dockerfile",
]);
const MOJIBAKE_PATTERN = new RegExp([
    "\u00c3",
    "\u00c4",
    "\u00c5",
    "\u00e2\u20ac",
    "\u00e2\u20ac\u201d",
    "\u00e2\u2022",
    "\u011f\u0178",
    "\u00ef\u00b8",
    "\ufffd",
].join("|"));
const STALE_REPORTS = new Set([
    "eslint-errors.txt",
    "eslint_report.json",
    "typescript-errors.txt",
    "lint_utf8.txt",
]);

function extension(path: string): string {
    const dot = path.lastIndexOf(".");
    return dot === -1 ? "" : path.slice(dot);
}

const trackedFiles = execFileSync("git", ["ls-files", "-z"])
    .toString("utf8")
    .split("\0")
    .filter(Boolean);
const decoder = new TextDecoder("utf-8", { fatal: true });

for (const path of STALE_REPORTS) {
    assert.equal(existsSync(path), false, `${path} must not be committed or retained`);
}

for (const path of trackedFiles) {
    if (!existsSync(path)) continue;
    assert.equal(STALE_REPORTS.has(path), false, `${path} is a stale generated report`);
    if (!TEXT_EXTENSIONS.has(extension(path)) && !TEXT_BASENAMES.has(path)) continue;

    const bytes = readFileSync(path);
    assert.equal(
        bytes.subarray(0, 2).equals(Buffer.from([0xff, 0xfe])) ||
            bytes.subarray(0, 2).equals(Buffer.from([0xfe, 0xff])),
        false,
        `${path} must not use UTF-16`
    );

    const content = decoder.decode(bytes);
    assert.equal(
        MOJIBAKE_PATTERN.test(content),
        false,
        `${path} contains a common mojibake marker`
    );
}

const socketSource = readFileSync(
    "apps/web/src/lib/socket/game-socket.ts",
    "utf8"
);
assert.match(socketSource, /"oyun_baslat"/);
assert.match(socketSource, /"takim_degistir"/);
assert.match(socketSource, /\\u00c4\\u00b0ste\\u00c4\\u0178i/);
const escapedLegacyStartAlias = socketSource.match(
    /"(oyunBaslat(?:[A-Za-z]|\\u[0-9a-f]{4})+)"/
)?.[1];
assert.ok(escapedLegacyStartAlias, "escaped legacy start alias is missing");
assert.equal(
    JSON.parse(`"${escapedLegacyStartAlias}"`),
    `oyunBaslat${String.fromCodePoint(0xc4, 0xb0)}ste${String.fromCodePoint(0xc4, 0x178)}i`
);

console.log(`Encoding integrity checks passed for ${trackedFiles.length} tracked files.`);
