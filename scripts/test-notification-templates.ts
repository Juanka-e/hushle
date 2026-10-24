import assert from "node:assert/strict";
import { readdirSync, readFileSync } from "node:fs";
import path from "node:path";
import ts from "typescript";
import { translate } from "../apps/web/src/lib/i18n/dictionaries";
import {
    NOTIFICATION_TEMPLATE_IDS,
    notificationTemplate,
    parseNotificationTemplate,
    renderNotificationText,
    type NotificationText,
} from "../apps/web/src/lib/notifications/templates";

const stored: NotificationText = {
    title: "Kayıtlı başlık",
    body: "Kayıtlı gövde",
    actionLabel: "Kayıtlı düğme",
};
const render = (metadata: unknown, locale: "tr" | "en" = "en", text: NotificationText = stored) =>
    renderNotificationText(text, metadata, locale);
const withTemplate = (id: string, params?: unknown) => ({ kind: "x", template: { id, params } });

// ── 1. Every template renders in both locales with its required params ──

const sampleParams: Record<string, string | number | boolean> = {
    item: "Neon Owl",
    bundle: "Legends Cache",
    amount: 250,
    ticket: 42,
    product: "1000 Coin",
    coupon: "LAUNCH10",
    underReview: true,
    defaultNotice: true,
};
assert.ok(NOTIFICATION_TEMPLATE_IDS.length >= 13, "all notification templates are registered");
for (const id of NOTIFICATION_TEMPLATE_IDS) {
    const tr = render(withTemplate(id, sampleParams), "tr");
    const en = render(withTemplate(id, sampleParams), "en");
    for (const [locale, text] of [["tr", tr], ["en", en]] as const) {
        for (const value of [text.title, text.body, text.actionLabel ?? ""]) {
            assert.doesNotMatch(value, /\{[a-zA-Z]+\}/, `${id} (${locale}) leaves no placeholder: ${value}`);
            assert.doesNotMatch(value, /^notifications\./, `${id} (${locale}) resolves its keys: ${value}`);
        }
        assert.notEqual(text.title, stored.title, `${id} (${locale}) renders its own title`);
    }
    assert.notEqual(tr.title, en.title, `${id} has an English title`);
}

// ── 2. Rendering details ──

assert.deepEqual(render(withTemplate("inventoryGranted", { item: "Neon Owl" }), "en"), {
    title: "New cosmetic added",
    body: "An admin added Neon Owl to your inventory.",
    actionLabel: "Open Inventory",
});
assert.deepEqual(render(withTemplate("inventoryGranted", { item: "Neon Owl" }), "tr"), {
    title: "Yeni kozmetik eklendi",
    body: "Neon Owl envanterine yönetici tarafından eklendi.",
    actionLabel: "Envanteri Aç",
});
assert.equal(
    render(withTemplate("itemPurchased", { item: "Pulse Fox", coupon: "" })).body,
    "Pulse Fox was added to your inventory."
);
assert.equal(
    render(withTemplate("itemPurchased", { item: "Pulse Fox", coupon: "LAUNCH10" })).body,
    "Pulse Fox was added to your inventory. Coupon LAUNCH10 was applied."
);
assert.equal(
    render(withTemplate("bundlePurchased", { bundle: "Legends Cache", coupon: "" }), "tr").body,
    "Legends Cache paketi envanterine işlendi."
);
assert.equal(render(withTemplate("coinGrantRedeemed", { amount: 250 })).body, "250 coins were added to your account.");
assert.equal(
    render(withTemplate("supportResolved", { ticket: 42 })).body,
    "Support ticket #42 was marked as resolved. You can open a new ticket from the Help Center if you need to."
);
assert.equal(render(withTemplate("supportClosed", { ticket: 42 }), "tr").title, "Destek talebin kapatıldı");
assert.equal(render(withTemplate("paymentRefunded", { product: "1000 Coin", underReview: true })).body, "1000 Coin is under a security review.");
assert.equal(
    render(withTemplate("paymentChargeback", { product: "1000 Coin", underReview: false })).body,
    "Your access to 1000 Coin was updated to match the payment status."
);
assert.equal(render(withTemplate("paymentChargebackRecorded", { product: "1000 Coin" })).title, "Payment chargeback processed");

// Staff-written bodies stay as written; only the title follows the locale.
const staffReply = { ...stored, body: "Merhaba, sorunu çözdük." };
assert.deepEqual(render(withTemplate("supportReply"), "en", staffReply), {
    title: "New reply from the support team",
    body: "Merhaba, sorunu çözdük.",
    actionLabel: "Open in Help Center",
});
assert.equal(render(withTemplate("paymentReviewUpdated", { defaultNotice: false }), "en", staffReply).body, staffReply.body);
assert.equal(
    render(withTemplate("paymentReviewUpdated", { defaultNotice: true }), "en", staffReply).body,
    translate("en", "notifications.templates.paymentReviewCompletedBody")
);
// A row stored without an action keeps none.
assert.equal(render(withTemplate("inventoryRevoked", { item: "X" }), "en", { ...stored, actionLabel: null }).actionLabel, null);
// Long params are cut; the text stays usable.
assert.ok(render(withTemplate("inventoryGranted", { item: "A".repeat(500) })).body.length < 260);
assert.deepEqual(notificationTemplate("supportReply"), { id: "supportReply", params: {} });

// ── 3. Anything malformed falls back to the stored text ──

for (const metadata of [
    null,
    undefined,
    "inventoryGranted",
    [],
    { kind: "legacy" },
    { template: null },
    { template: [] },
    { template: "inventoryGranted" },
    withTemplate("unknownTemplate", { item: "X" }),
    withTemplate("__proto__", { item: "X" }),
    withTemplate("constructor", { item: "X" }),
    withTemplate("toString", { item: "X" }),
    withTemplate("inventoryGranted"),
    withTemplate("inventoryGranted", { item: "" }),
    withTemplate("inventoryGranted", "Neon Owl"),
    withTemplate("inventoryGranted", ["Neon Owl"]),
    withTemplate("inventoryGranted", { item: { name: "Neon Owl" } }),
    withTemplate("inventoryGranted", { item: ["Neon Owl"] }),
    withTemplate("inventoryGranted", { item: null }),
    withTemplate("coinGrantRedeemed", { amount: Number.NaN }),
    withTemplate("inventoryGranted", Object.fromEntries(Array.from({ length: 9 }, (_, i) => [`p${i}`, "x"]))),
    { template: { params: { item: "X" } } },
    { template: { id: 7, params: { item: "X" } } },
]) {
    assert.deepEqual(render(metadata), stored, `falls back for ${JSON.stringify(metadata)}`);
    assert.equal(parseNotificationTemplate(metadata), null);
}
// Stored JSON can carry a "__proto__" key; it must not reach Object.prototype.
const polluted = JSON.parse('{"template":{"id":"inventoryGranted","params":{"item":"X","__proto__":{"polluted":"yes"}}}}');
assert.deepEqual(render(polluted), stored, "a non-scalar param rejects the template");
assert.equal(({} as { polluted?: string }).polluted, undefined, "Object.prototype is untouched");
const protoKey = JSON.parse('{"template":{"id":"inventoryGranted","params":{"item":"X","__proto__":"y"}}}');
assert.equal(render(protoKey).title, "New cosmetic added");
assert.equal(({} as { polluted?: string }).polluted, undefined);

// ── 4. Every notification written in the code carries a registered template ──

const SOURCE_ROOTS = ["apps/web/src", "packages/platform-payments/src", "apps/jobs/src"];
function listSources(dir: string): string[] {
    return (readdirSync(dir, { recursive: true }) as string[])
        .map((entry) => `${dir}/${entry.split(path.sep).join("/")}`)
        .filter((file) => /\.tsx?$/.test(file));
}
const registered = new Set<string>(NOTIFICATION_TEMPLATE_IDS);
let notificationWrites = 0;
const problems: string[] = [];
for (const file of SOURCE_ROOTS.flatMap(listSources)) {
    if (file.endsWith("lib/notifications/service.ts") || file.endsWith("lib/notifications/templates.ts")) continue;
    const sf = ts.createSourceFile(file, readFileSync(file, "utf8"), ts.ScriptTarget.Latest, true);
    const visit = (node: ts.Node) => {
        if (ts.isCallExpression(node)) {
            const callee = node.expression.getText(sf);
            if (callee === "createUserNotificationWithClient" || /\.notification\.create$/.test(callee)) {
                notificationWrites += 1;
                const where = `${file}:${sf.getLineAndCharacterOfPosition(node.getStart(sf)).line + 1}`;
                const text = node.getText(sf);
                const ids = [
                    ...text.matchAll(/notificationTemplate\(\s*"([A-Za-z]+)"/g),
                    ...text.matchAll(/template:\s*\{\s*id:\s*"([A-Za-z]+)"/g),
                ].map((match) => match[1]);
                // Conditional ids (`a ? "x" : "y"`) are listed as string literals inside the template.
                const conditional = text.match(/template:[\s\S]*?\?\s*"([A-Za-z]+)"\s*:\s*"([A-Za-z]+)"/);
                if (conditional) ids.push(conditional[1], conditional[2]);
                if (ids.length === 0) problems.push(`${where} writes a notification without a template`);
                for (const id of ids) if (!registered.has(id)) problems.push(`${where} uses unknown template "${id}"`);
            }
        }
        ts.forEachChild(node, visit);
    };
    visit(sf);
}
assert.ok(notificationWrites >= 11, `expected the notification writes, found ${notificationWrites}`);
assert.deepEqual(problems, [], problems.join("\n"));

console.log(
    `notification templates passed: ${NOTIFICATION_TEMPLATE_IDS.length} templates, ${notificationWrites} notification writes checked`
);
