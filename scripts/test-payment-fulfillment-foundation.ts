import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import {
    PaymentFulfillmentError,
    fulfillPaidPaymentOrder,
    normalizePaymentGrantSnapshot,
} from "@hushle/platform-payments";

const renderSnapshot = {
    type: "avatar",
    rarity: "epic",
    renderMode: "image",
    renderSpecVersion: 1,
    imageUrl: "/images/avatar.png",
    templateKey: null,
    templateConfig: null,
    badgeText: null,
};

assert.deepEqual(
    normalizePaymentGrantSnapshot({
        productKind: "coin_pack",
        quantity: 3,
        grantSnapshot: { schemaVersion: 1, coinAmount: 250 },
    }),
    { kind: "coin_pack", coinAmount: 750 }
);

assert.deepEqual(
    normalizePaymentGrantSnapshot({
        productKind: "cosmetic_item",
        quantity: 1,
        grantSnapshot: {
            schemaVersion: 1,
            items: [{ shopItemId: 42, renderSnapshot }],
        },
    }),
    {
        kind: "cosmetic_item",
        items: [{ shopItemId: 42, renderSnapshot }],
    }
);

for (const invalid of [
    {
        productKind: "cosmetic_item" as const,
        quantity: 2,
        grantSnapshot: {
            schemaVersion: 1,
            items: [{ shopItemId: 42, renderSnapshot }],
        },
    },
    {
        productKind: "cosmetic_bundle" as const,
        quantity: 1,
        grantSnapshot: {
            schemaVersion: 1,
            items: [
                { shopItemId: 42, renderSnapshot },
                { shopItemId: 42, renderSnapshot },
            ],
        },
    },
    {
        productKind: "coin_pack" as const,
        quantity: 1,
        grantSnapshot: { schemaVersion: 1, coinAmount: 0 },
    },
]) {
    assert.throws(
        () => normalizePaymentGrantSnapshot(invalid),
        (error: unknown) =>
            error instanceof PaymentFulfillmentError
            && error.code === "invalid_grant_snapshot"
    );
}

const schema = readFileSync("prisma/schema.prisma", "utf8");
const migration = readFileSync(
    "prisma/migrations/20260808230000_payment_fulfillment_foundation/migration.sql",
    "utf8"
);
const webCompatibilityExport = readFileSync(
    "apps/web/src/lib/wallet-ledger/service.ts",
    "utf8"
);
assert.match(schema, /payment_topup/);
assert.match(migration, /'payment_topup'/);
assert.match(webCompatibilityExport, /@hushle\/platform-wallet/);

async function finish(): Promise<void> {
    await assert.rejects(
        () => fulfillPaidPaymentOrder({ orderId: "not-a-uuid" }),
        (error: unknown) =>
            error instanceof PaymentFulfillmentError
            && error.code === "invalid_order_id"
    );
    console.log("payment fulfillment foundation checks passed");
}

void finish();
