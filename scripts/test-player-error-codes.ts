import assert from "node:assert/strict";
import { readdirSync, readFileSync } from "node:fs";
import path from "node:path";
import ts from "typescript";
import { dictionaries, translate } from "../apps/web/src/lib/i18n/dictionaries";
import {
    PLAYER_ERROR_CODES,
    PlayerErrorCode,
    isPlayerErrorCode,
} from "../apps/web/src/lib/errors/player-error-codes";
import {
    getPlayerErrorMessage,
    playerError,
    playerErrorFromValidation,
} from "../apps/web/src/lib/errors/player-error";
import {
    isRoomNotFoundError,
    readApiPlayerError,
    readSocketPlayerError,
    resolveApiErrorMessage,
    resolvePlayerErrorMessage,
    sanitizePlayerErrorParams,
} from "../apps/web/src/lib/errors/resolve-player-error";
import {
    SOCKET_ERROR_EVENT,
    buildSocketPlayerError,
    emitPlayerError,
    playerErrorAck,
} from "../apps/web/src/lib/socket/player-error-emit";
import { passwordPolicyError } from "../apps/web/src/lib/auth/password-policy-error";
import { getCheckoutProviderErrorCode } from "../apps/web/src/lib/payments/checkout-player-errors";
import { findFoldedTurkishWords } from "./lib/folded-turkish";

const API_ROOT = "apps/web/src/app/api";
/** Provider and framework callbacks: their callers are payment/email services or NextAuth, not players. */
const NON_PLAYER_ROUTES = new Set([
    "auth/[...nextauth]/route.ts",
    "email/webhooks/ses/route.ts",
    "payments/callback/iyzico/route.ts",
    "payments/webhooks/[provider]/route.ts",
]);
/** Admin-only messages that live outside api/admin; the admin panel is Turkish-only by design. */
const ADMIN_ONLY_STRINGS = new Set(["Yetkisiz erişim."]);

function listFiles(dir: string, filter: (file: string) => boolean): string[] {
    return (readdirSync(dir, { recursive: true }) as string[])
        .map((entry) => entry.split(path.sep).join("/"))
        .filter(filter)
        .map((entry) => `${dir}/${entry}`)
        .sort();
}

const playerRoutes = listFiles(API_ROOT, (file) => file.endsWith("route.ts"))
    .filter((file) => !file.startsWith(`${API_ROOT}/admin/`))
    .filter((file) => !NON_PLAYER_ROUTES.has(file.slice(API_ROOT.length + 1)));
assert.ok(playerRoutes.length >= 40, `expected the player routes, found ${playerRoutes.length}`);

const socketSources = [
    ...listFiles("apps/web/src/lib/socket", (file) => file.endsWith(".ts")),
    "apps/web/server.ts",
    "apps/web/server-runtime.ts",
];
const supportSources = [
    "apps/web/src/proxy.ts",
    "apps/web/src/lib/auth/account-capability.ts",
    "apps/web/src/lib/auth/password-policy-error.ts",
    "apps/web/src/lib/system-settings/policies.ts",
    "apps/web/src/lib/payments/checkout-player-errors.ts",
    "apps/web/src/lib/economy.ts",
    "packages/platform-store/src/index.ts",
    ...listFiles("apps/web/src/lib/errors", (file) => file.endsWith(".ts")),
];

function parse(file: string): ts.SourceFile {
    return ts.createSourceFile(file, readFileSync(file, "utf8"), ts.ScriptTarget.Latest, true);
}

function lineOf(sf: ts.SourceFile, node: ts.Node): string {
    return `${sf.fileName}:${sf.getLineAndCharacterOfPosition(node.getStart(sf)).line + 1}`;
}

function walk(node: ts.Node, visit: (node: ts.Node) => void): void {
    visit(node);
    ts.forEachChild(node, (child) => walk(child, visit));
}

function propertyNames(node: ts.ObjectLiteralExpression, sf: ts.SourceFile): string[] {
    return node.properties.flatMap((property) =>
        (ts.isPropertyAssignment(property) || ts.isShorthandPropertyAssignment(property)) && property.name
            ? [property.name.getText(sf)]
            : []
    );
}

// ── 1. Static scan: every socket `hata` emit and every HTTP error body carries a code ──

const hataViolations: string[] = [];
const emitHelperFile = "apps/web/src/lib/socket/player-error-emit.ts";
let emitPlayerErrorCalls = 0;
for (const file of socketSources) {
    const sf = parse(file);
    walk(sf, (node) => {
        if (ts.isStringLiteral(node) && node.text === SOCKET_ERROR_EVENT && file !== emitHelperFile) {
            hataViolations.push(`${lineOf(sf, node)} emits "hata" without emitPlayerError`);
        }
        if (!ts.isCallExpression(node)) return;
        const callee = node.expression.getText(sf);
        if (callee === "emitPlayerError") {
            emitPlayerErrorCalls += 1;
            const code = node.arguments[1];
            if (!code || code.getText(sf) === "undefined") {
                hataViolations.push(`${lineOf(sf, node)} emitPlayerError without a code`);
            }
        }
        if (/\.emit$/.test(callee) && node.arguments[0]?.getText(sf) === "SOCKET_ERROR_EVENT") {
            if (file !== emitHelperFile || node.arguments.length !== 3) {
                hataViolations.push(`${lineOf(sf, node)} raw hata emit`);
            }
        }
        // Socket acknowledgements must use playerErrorAck when they report a failure.
        if (callee === "callback") {
            const arg = node.arguments[0];
            if (arg && ts.isObjectLiteralExpression(arg) && propertyNames(arg, sf).includes("error")) {
                hataViolations.push(`${lineOf(sf, node)} ack error without playerErrorAck`);
            }
        }
    });
}
assert.deepEqual(hataViolations, [], hataViolations.join("\n"));
assert.ok(emitPlayerErrorCalls >= 50, `expected the socket error emits, found ${emitPlayerErrorCalls}`);
const gameSocketSource = readFileSync("apps/web/src/lib/socket/game-socket.ts", "utf8");
assert.equal((gameSocketSource.match(/playerErrorAck\(/g) ?? []).length, 6, "display-name acks carry codes");
assert.match(gameSocketSource, /code: PlayerErrorCode\.SERVER_BUSY,/, "kapasiteEngeli carries a code");

const httpViolations: string[] = [];
let playerErrorUses = 0;
for (const file of [...playerRoutes, ...supportSources]) {
    const sf = parse(file);
    walk(sf, (node) => {
        if (ts.isCallExpression(node) && /^(playerError|playerErrorFromValidation|passwordPolicyError)$/.test(node.expression.getText(sf))) {
            playerErrorUses += 1;
        }
        if (!ts.isObjectLiteralExpression(node)) return;
        const names = propertyNames(node, sf);
        if (!names.includes("error")) return;
        const call = node.parent;
        const isResponseBody =
            ts.isCallExpression(call) &&
            /(NextResponse|Response)\.json$/.test(call.expression.getText(sf)) &&
            call.arguments[0] === node;
        if (isResponseBody && !names.includes("code")) {
            const text = node.getText(sf);
            const adminOnly = [...ADMIN_ONLY_STRINGS].some((value) => text.includes(value)) ||
                /getAdminAccessFailureMessage/.test(text);
            if (!adminOnly) httpViolations.push(`${lineOf(sf, node)} ${text.replace(/\s+/g, " ")}`);
        }
        // Player routes build every error body through playerError(); a literal is a regression.
        if (playerRoutes.includes(file)) {
            httpViolations.push(`${lineOf(sf, node)} literal { error } in a player route`);
        }
    });
}
assert.deepEqual(httpViolations, [], httpViolations.join("\n"));
assert.ok(playerErrorUses >= 200, `expected the route error bodies, found ${playerErrorUses}`);

// ── 2. Dictionary coverage: tr + en text for every code, matching placeholders, no extras ──

const placeholders = (text: string) => [...text.matchAll(/\{([a-zA-Z0-9_]+)\}/g)].map((match) => match[1]).sort();
for (const [key, value] of Object.entries(PlayerErrorCode)) {
    assert.equal(key, value, `PlayerErrorCode.${key} must map to itself`);
}
assert.equal(new Set(PLAYER_ERROR_CODES).size, PLAYER_ERROR_CODES.length);
assert.deepEqual(Object.keys(dictionaries.tr.errors).sort(), [...PLAYER_ERROR_CODES].sort(), "tr errors match the codes");
assert.deepEqual(Object.keys(dictionaries.en.errors).sort(), [...PLAYER_ERROR_CODES].sort(), "en errors match the codes");
const TURKISH_LETTERS = /[çğıöşüÇĞİÖŞÜ]/;
for (const code of PLAYER_ERROR_CODES) {
    const tr = (dictionaries.tr.errors as Record<string, string>)[code];
    const en = (dictionaries.en.errors as Record<string, string>)[code];
    assert.ok(tr?.trim(), `${code} has Turkish text`);
    assert.ok(en?.trim(), `${code} has English text`);
    assert.deepEqual(placeholders(tr), placeholders(en), `${code} placeholders match`);
    assert.doesNotMatch(en, TURKISH_LETTERS, `${code} English text has no Turkish letters`);
    assert.notEqual(tr, en, `${code} is translated`);
}
// Existing wire codes keep their names.
for (const code of [
    "RATE_LIMITED", "GUEST_CLAIM_INVALID", "GUEST_CLAIM_LINKED_ELSEWHERE", "EMAIL_VERIFICATION_REQUIRED",
    "CHECKOUT_UNAVAILABLE", "VERIFIED_EMAIL_REQUIRED", "LEGAL_VERSION_MISMATCH", "INVALID_GRANT_SNAPSHOT",
    "IDEMPOTENCY_CONFLICT", "CHECKOUT_FAILED", "SOCKET_PROTOCOL_UNSUPPORTED", "CHECKOUT_IN_PROGRESS",
    "CHECKOUT_UNCERTAIN", "PROVIDER_TIMEOUT", "PROVIDER_UNAVAILABLE", "PROVIDER_RATE_LIMITED", "PROVIDER_REJECTED",
    "INVALID_PROVIDER_RESPONSE", "CHECKOUT_STATE_CONFLICT", "ORDER_NOT_FOUND", "ORDER_NOT_ELIGIBLE", "INVALID_REQUEST",
]) {
    assert.ok(isPlayerErrorCode(code), `${code} stays a valid code`);
}

// ── 3. No ASCII-folded Turkish in player-facing server text or in the admin panel ──

const FOLDED_TURKISH =
    /(^|[^a-zçğıöşü])(gecersiz|lutfen|baslat|basla|sifirla|olustur|bulunamadi|cok fazla|gonder|guncelle|yukle|giris|basarisiz|dogrula|kullanici|kullanim|odasindasin|kapali|degil|islem|gecici|yonetici|takim|askiya|erisim|hizli|kusan|magaza|urun|odul|icin|su anda|tamamlanmadi|sahiplenilmis|alinmis|kullaniliyor)/i;
const isFolded = (value: string) => /\s/.test(value) && FOLDED_TURKISH.test(value.toLocaleLowerCase("tr-TR"));
assert.ok(isFolded("Oyun zaten baslatiliyor. Lutfen bekleyin."), "heuristic catches folded text");
assert.ok(isFolded("Gecersiz baglanti origin'i."), "heuristic catches folded text");
assert.ok(!isFolded("Oyun zaten başlatılıyor. Lütfen bekleyin."), "heuristic accepts correct Turkish");
assert.ok(!isFolded("oyun_baslat"), "event names are not messages");
// The word list catches folded words the stems miss, including single-word labels.
const hasFoldedTurkish = (value: string) => isFolded(value) || findFoldedTurkishWords(value).length > 0;
assert.deepEqual(findFoldedTurkishWords("Duyuru olusturulamadi. Lutfen tekrar deneyin."), ["olusturulamadi", "Lutfen"]);
assert.deepEqual(findFoldedTurkishWords("Duyuru oluşturulamadı. Lütfen tekrar deneyin."), []);
assert.deepEqual(findFoldedTurkishWords("Askida"), ["Askida"], "single-word labels are checked");
assert.deepEqual(findFoldedTurkishWords("Iptal · Tum durumlar"), ["Iptal", "Tum"], "dotted İ and short words");
assert.deepEqual(findFoldedTurkishWords("İptal · Tüm durumlar · iptal"), []);
assert.deepEqual(findFoldedTurkishWords("YENİ / SINIRLI"), [], "a capital I is correct for ı");
assert.deepEqual(findFoldedTurkishWords("Retried once, sure. Turu tamamla."), [], "valid English and Turkish words pass");

const foldedViolations: string[] = [];
for (const [code, text] of Object.entries(dictionaries.tr.errors)) {
    if (hasFoldedTurkish(text)) foldedViolations.push(`errors.${code}: ${text}`);
}
for (const file of [...playerRoutes, ...socketSources, ...supportSources]) {
    const sf = parse(file);
    walk(sf, (node) => {
        let value: string | null = null;
        if (ts.isStringLiteral(node) || ts.isNoSubstitutionTemplateLiteral(node) || ts.isTemplateLiteralToken(node)) {
            value = node.text;
        }
        if (value === null || !hasFoldedTurkish(value) || ADMIN_ONLY_STRINGS.has(value)) return;
        const statement = node.parent?.parent?.getText(sf) ?? "";
        if (/^console\./.test(statement)) return;
        foldedViolations.push(`${lineOf(sf, node)}: ${value}`);
    });
}

/**
 * The admin panel is Turkish-only (no i18n), so its text must be spelled with Turkish letters: admin API
 * routes, admin pages and components, and the shared services whose messages reach the panel.
 */
const ADMIN_TEXT_SOURCES = [
    ...listFiles(`${API_ROOT}/admin`, (file) => file.endsWith(".ts")),
    ...readdirSync("apps/web/src/lib")
        .filter((name) => name.startsWith("admin"))
        .flatMap((name) => listFiles(`apps/web/src/lib/${name}`, (file) => /\.tsx?$/.test(file))),
    ...listFiles("apps/web/src/app/admin", (file) => /\.tsx?$/.test(file)),
    ...listFiles("apps/web/src/components/admin", (file) => /\.tsx?$/.test(file)),
    "apps/web/src/lib/announcements/content.ts",
    "apps/web/src/lib/categories/admin-category-policy.ts",
    "apps/web/src/lib/coin-grants/schema.ts",
    "apps/web/src/lib/integrations/service.ts",
    "apps/web/src/lib/moderation/schema.ts",
    "apps/web/src/lib/support/schema.ts",
    "apps/web/src/lib/support/service.ts",
    "apps/web/src/lib/system-settings/schema.ts",
    "apps/web/src/lib/words/category-assignment-policy.ts",
    "apps/web/src/lib/words/category-selection-ui.ts",
];
assert.ok(ADMIN_TEXT_SOURCES.length >= 100, `expected the admin sources, found ${ADMIN_TEXT_SOURCES.length}`);
/** Values, keys, paths and URLs are not text: one lower-case token, or one token with path punctuation. */
const isKeyLike = (value: string) =>
    !/\s/.test(value) && (/^[a-z0-9_-]+$/.test(value) || /[/:=@#?&]|\w\.\w/.test(value));
let adminTexts = 0;
for (const file of ADMIN_TEXT_SOURCES) {
    const sf = parse(file);
    walk(sf, (node) => {
        let value: string | null = null;
        if (ts.isStringLiteral(node) || ts.isNoSubstitutionTemplateLiteral(node) || ts.isTemplateLiteralToken(node)) {
            value = node.text.trim();
        } else if (ts.isJsxText(node)) {
            value = node.text.trim();
        }
        if (!value || isKeyLike(value) || !/[A-Za-z]{2}/.test(value)) return;
        adminTexts += 1;
        if (!hasFoldedTurkish(value)) return;
        const statement = node.parent?.parent?.getText(sf) ?? "";
        if (/^console\./.test(statement)) return;
        foldedViolations.push(`${lineOf(sf, node)}: ${value}`);
    });
}
assert.ok(adminTexts >= 2000, `expected the admin texts, found ${adminTexts}`);
assert.deepEqual(foldedViolations, [], foldedViolations.join("\n"));

// ── 4. Server helpers ──

assert.deepEqual(playerError(PlayerErrorCode.ROOM_NOT_FOUND), {
    error: "Bu oda bulunamadı.",
    code: "ROOM_NOT_FOUND",
});
assert.deepEqual(playerError(PlayerErrorCode.ROOM_FULL, { max: 8 }), {
    error: "Bu oda dolu. Oda kapasitesi 8 oyuncu.",
    code: "ROOM_FULL",
    params: { max: 8 },
});
assert.deepEqual(playerError(PlayerErrorCode.RATE_LIMITED, {}), playerError(PlayerErrorCode.RATE_LIMITED), "empty params are dropped");
assert.equal(getPlayerErrorMessage(PlayerErrorCode.TEAM_FULL, { team: "A", max: 5 }, "en"), "Team A is full. Each team can have at most 5 players.");

const zodLike = (key: PropertyKey) => ({ issues: [{ path: [key] }] });
assert.equal(playerErrorFromValidation(zodLike("email"), { email: PlayerErrorCode.INVALID_EMAIL }).code, "INVALID_EMAIL");
assert.equal(playerErrorFromValidation(zodLike("other"), { email: PlayerErrorCode.INVALID_EMAIL }).code, "INVALID_REQUEST");
assert.equal(playerErrorFromValidation(zodLike("constructor"), {}).code, "INVALID_REQUEST", "prototype keys never map");
assert.equal(playerErrorFromValidation(zodLike(0), { 0: PlayerErrorCode.INVALID_EMAIL }).code, "INVALID_REQUEST");
assert.equal(playerErrorFromValidation({ issues: [] }, {}, PlayerErrorCode.COIN_CODE_MALFORMED).code, "COIN_CODE_MALFORMED");

const emitted: unknown[][] = [];
emitPlayerError({ emit: (...args: unknown[]) => emitted.push(args) }, PlayerErrorCode.CONNECTION_DECISION_TOO_EARLY, {
    params: { seconds: 12 },
});
assert.deepEqual(emitted, [[
    "hata",
    "Oyunculara biraz daha süre tanıyın (12 sn).",
    { code: "CONNECTION_DECISION_TOO_EARLY", params: { seconds: 12 } },
]]);
assert.deepEqual(buildSocketPlayerError(PlayerErrorCode.MAINTENANCE_MODE, { customMessage: "  Bakım: 22.00  " }), {
    message: "Bakım: 22.00",
    meta: { code: "MAINTENANCE_MODE", custom: true },
});
assert.deepEqual(buildSocketPlayerError(PlayerErrorCode.SERVER_BUSY, { customMessage: "   " }), {
    message: "Sunucu şu anda yoğun. Lütfen kısa süre sonra tekrar deneyin.",
    meta: { code: "SERVER_BUSY" },
});
assert.deepEqual(playerErrorAck(PlayerErrorCode.LOBBY_NOT_FOUND), {
    ok: false,
    error: "Lobi bulunamadı.",
    code: "LOBBY_NOT_FOUND",
});

assert.deepEqual(passwordPolicyError("kisa", { utf8Bytes: 4 }), {
    error: "Parola en az 8 karakter olmalıdır.",
    code: "PASSWORD_TOO_SHORT",
    params: { min: 8 },
});
assert.equal(passwordPolicyError("ç".repeat(40), { utf8Bytes: 80 }).code, "PASSWORD_TOO_LONG_BYTES");
assert.equal(passwordPolicyError("password123", { utf8Bytes: 11 }).code, "PASSWORD_TOO_WEAK");

for (const providerCode of [
    "invalid_request", "order_not_found", "order_not_eligible", "checkout_in_progress", "checkout_uncertain",
    "provider_timeout", "provider_unavailable", "provider_rate_limited", "provider_rejected",
    "invalid_provider_response", "checkout_state_conflict",
] as const) {
    assert.equal(getCheckoutProviderErrorCode(providerCode), providerCode.toUpperCase(), "provider codes keep their wire names");
}

// ── 5. Client resolver fallbacks ──

const trRoomFull = "Bu oda dolu. Oda kapasitesi 8 oyuncu.";
// Known code: translated in the viewer's locale, with params.
assert.equal(resolvePlayerErrorMessage("en", { message: trRoomFull, code: "ROOM_FULL", params: { max: 8 } }), "This room is full. Room capacity is 8 players.");
assert.equal(resolvePlayerErrorMessage("tr", { message: "eski metin", code: "ROOM_FULL", params: { max: 8 } }), trRoomFull);
// Known code without a message still resolves (empty first hata argument).
assert.equal(resolvePlayerErrorMessage("en", { message: "", code: "ROOM_NOT_FOUND" }), "This room could not be found.");
// Unknown code falls back to the server message.
assert.equal(resolvePlayerErrorMessage("en", { message: "  Sunucu mesajı  ", code: "SOMETHING_NEW" }), "Sunucu mesajı");
// No code (old server) keeps showing the message.
assert.equal(resolvePlayerErrorMessage("en", { message: "Bu oda bulunamadı." }), "Bu oda bulunamadı.");
// Missing message and unknown code: the caller's fallback, else a generic localized error.
assert.equal(resolvePlayerErrorMessage("en", { code: "SOMETHING_NEW" }, "Purchase failed."), "Purchase failed.");
assert.equal(resolvePlayerErrorMessage("en", {}), "Something went wrong. Please try again.");
assert.equal(resolvePlayerErrorMessage("tr", { message: "   " }, "   "), "Bir hata oluştu. Lütfen tekrar dene.");
assert.equal(resolvePlayerErrorMessage("tr", { message: 42 as unknown as string, code: 7 }), "Bir hata oluştu. Lütfen tekrar dene.");
// Missing params never leak `{placeholders}`: use the server text, else the fallback.
assert.equal(resolvePlayerErrorMessage("en", { message: trRoomFull, code: "ROOM_FULL" }), trRoomFull);
assert.equal(resolvePlayerErrorMessage("en", { code: "ROOM_FULL" }, "Could not join."), "Could not join.");
assert.equal(resolvePlayerErrorMessage("en", { code: "ROOM_FULL", params: { max: { evil: true } } }), "Something went wrong. Please try again.");
// Param values are player text and may contain braces; they never trigger the fallback.
assert.equal(
    resolvePlayerErrorMessage("en", {
        message: "Yönetici süresi doldu. Yeni yönetici: {max}",
        code: "HOST_TIMEOUT_TRANSFERRED",
        params: { name: "{max}" },
    }),
    "The host timed out. New host: {max}"
);
assert.equal(resolvePlayerErrorMessage("en", { code: "TEAM_FULL", params: { team: "$&{team}", max: 5 } }), "Team $&{team} is full. Each team can have at most 5 players.");
// Operator-written notices: Turkish viewers see the notice, English viewers the dictionary text.
const notice = { message: "Bakım 22.00'de bitecek.", code: "MAINTENANCE_MODE", custom: true };
assert.equal(resolvePlayerErrorMessage("tr", notice), "Bakım 22.00'de bitecek.");
assert.equal(resolvePlayerErrorMessage("en", notice), "The server is under maintenance. Please try again later.");
assert.equal(resolvePlayerErrorMessage("tr", { ...notice, custom: "true" }), "Sunucu bakım modunda. Lütfen daha sonra tekrar deneyin.");
// Params: only strings and finite numbers survive; inherited keys are ignored.
assert.deepEqual({ ...sanitizePlayerErrorParams({ a: "x", b: 2, c: Number.NaN, d: null, e: {}, f: Infinity }) }, { a: "x", b: 2 });
assert.equal(sanitizePlayerErrorParams([1, 2]), undefined);
assert.equal(sanitizePlayerErrorParams({ c: Number.NaN }), undefined);
assert.equal(resolvePlayerErrorMessage("en", { code: "TEAM_FULL", params: JSON.parse('{"__proto__":{"team":"X"},"max":3}') }, "fallback"), "fallback");
// Socket and HTTP readers tolerate anything.
assert.deepEqual(readSocketPlayerError("m"), { message: "m", code: undefined, params: undefined, custom: undefined });
assert.deepEqual(readSocketPlayerError("m", ["ROOM_FULL"]), { message: "m", code: undefined, params: undefined, custom: undefined });
assert.equal(readSocketPlayerError("m", { code: "ROOM_FULL", params: { max: 3 } }).code, "ROOM_FULL");
assert.deepEqual(readApiPlayerError(null), {});
assert.deepEqual(readApiPlayerError("nope"), {});
assert.deepEqual(readApiPlayerError({ error: "x", code: "RATE_LIMITED" }), { message: "x", code: "RATE_LIMITED", params: undefined });
assert.equal(resolveApiErrorMessage("en", { error: "Çok fazla deneme yaptın.", code: "RATE_LIMITED" }), "Too many attempts. Wait a moment and try again.");
assert.equal(resolveApiErrorMessage("en", null, "Request failed."), "Request failed.");
assert.equal(resolveApiErrorMessage("en", { ok: false, error: "Lobi bulunamadı.", code: "LOBBY_NOT_FOUND" }), "Lobby not found.");
// Room page: only a missing room sends the player home.
assert.equal(isRoomNotFoundError({ code: "ROOM_NOT_FOUND", message: "x" }), true);
assert.equal(isRoomNotFoundError({ code: "PLAYER_NOT_FOUND", message: "Oyuncu bulunamadı." }), false);
assert.equal(isRoomNotFoundError({ message: "Bu oda bulunamadı." }), true, "servers without codes");
assert.equal(isRoomNotFoundError({ message: "Room not found" }), true);
assert.equal(isRoomNotFoundError({ message: "Oyun zaten devam ediyor." }), false);
assert.equal(isRoomNotFoundError({}), false);

// The English UI never shows Turkish for a known code, whatever the server sent.
const sampleParams = { seconds: 5, roomCode: "ABC123", max: 8, team: "A", name: "Ece", minimum: 4, min: 8 };
for (const code of PLAYER_ERROR_CODES) {
    const tr = getPlayerErrorMessage(code, sampleParams);
    assert.doesNotMatch(tr, /\{[a-zA-Z0-9_]+\}/, `${code} Turkish text resolves every placeholder`);
    const en = resolvePlayerErrorMessage("en", readSocketPlayerError(tr, buildSocketPlayerError(code, { params: sampleParams }).meta));
    assert.equal(en, translate("en", `errors.${code}`, sampleParams));
    assert.doesNotMatch(en, TURKISH_LETTERS, `${code} resolves to English`);
}

// ── 6. Client call sites read codes instead of raw server text ──

const clientSources = [
    "apps/web/src/app/page.tsx",
    "apps/web/src/app/room/[code]/page.tsx",
    "apps/web/src/components/game/authenticated-dashboard-home.tsx",
    "apps/web/src/app/forgot-password/page.tsx",
    "apps/web/src/app/register/page.tsx",
    "apps/web/src/app/reset-password/reset-password-client.tsx",
    "apps/web/src/app/verify-email/verify-email-client.tsx",
    "apps/web/src/app/verify-email-change/verify-email-change-client.tsx",
    "apps/web/src/components/game/dashboard-pages/settings-content.tsx",
    "apps/web/src/components/game/dashboard-pages/shop-content.tsx",
    "apps/web/src/components/game/support-desk-sheet.tsx",
    "apps/web/src/components/payments/checkout-content.tsx",
];
for (const file of clientSources) {
    const source = readFileSync(file, "utf8");
    assert.doesNotMatch(source, /\b(?:payload|data|response|result)\??\.error\s*(?:\|\||\?)/, `${file} resolves errors by code`);
    assert.doesNotMatch(source, /"error" in payload/, `${file} resolves errors by code`);
    if (/on\("hata"/.test(source)) {
        assert.match(source, /readSocketPlayerError\(/, `${file} reads the hata code`);
    }
}

console.log(
    `player error codes passed: ${PLAYER_ERROR_CODES.length} codes, ${emitPlayerErrorCalls} socket emits, ${playerErrorUses} HTTP error bodies in ${playerRoutes.length} routes`
);
