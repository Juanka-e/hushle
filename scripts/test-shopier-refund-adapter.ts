import assert from "node:assert/strict";
import {
    createPaymentRefundAdapter,
    createShopierRefund,
    getPaymentRefundReadiness,
    getShopierRefund,
    listShopierRefundsByOrder,
    SHOPIER_API_BASE_URL,
    SHOPIER_REFUNDS_PATH,
    ShopierAdapterError,
} from "@hushle/platform-payments";

const token = "shopier-pat-test-token-with-safe-length-123";
const credentials = { personalAccessToken: token };
const orderId = "shopier-order-1001";
const refund = {
    id: "refund-1001", type: "full", status: "pending", orderId,
    dateCreated: "2026-08-10T16:00:00Z", currency: "TRY", total: "12.50",
};

async function expectCode(action: () => Promise<unknown>, code: string): Promise<void> {
    await assert.rejects(action, (error: unknown) => {
        assert.ok(error instanceof ShopierAdapterError);
        assert.equal(error.code, code);
        return true;
    });
}

async function run(): Promise<void> {
    let url = "";
    let body = "";
    let headers = new Headers();
    const created = await createShopierRefund({
        orderId, amountMinor: 1_250, currency: "TRY", note: "Test tam iade.", credentials,
        fetchImpl: async (input, init) => {
            url = String(input); body = String(init?.body); headers = new Headers(init?.headers);
            assert.equal(init?.method, "POST");
            assert.equal(init?.redirect, "error");
            return new Response(JSON.stringify(refund));
        },
    });
    assert.equal(url, `${SHOPIER_API_BASE_URL}${SHOPIER_REFUNDS_PATH}`);
    assert.equal(headers.get("authorization"), `Bearer ${token}`);
    assert.equal(body.includes(token), false);
    assert.deepEqual(JSON.parse(body), { orderId, amount: "12.50", note: "Test tam iade." });
    assert.equal(created.id, refund.id);
    const failed = await createShopierRefund({
        orderId, amountMinor: 1_250, currency: "TRY", note: "Test tam iade.", credentials,
        fetchImpl: async () => new Response(JSON.stringify({ ...refund, status: "failed" })),
    });
    assert.equal(failed.status, "failed", "terminal provider state must retain the refund ID for audit");

    await getShopierRefund({ refundId: refund.id, credentials, fetchImpl: async (input, init) => {
        assert.equal(String(input), `${SHOPIER_API_BASE_URL}${SHOPIER_REFUNDS_PATH}/${refund.id}`);
        assert.equal(init?.method, "GET");
        return new Response(JSON.stringify({ ...refund, status: "succeeded", dateRefunded: "2026-08-10T16:01:00Z" }));
    } });
    await expectCode(() => getShopierRefund({ refundId: "../orders", credentials }), "invalid_request");

    const listed = await listShopierRefundsByOrder({
        orderId, dateStart: new Date("2026-08-10T15:55:00Z"), dateEnd: new Date("2026-08-10T16:05:00Z"), credentials,
        fetchImpl: async (input) => {
            const requestUrl = new URL(String(input));
            assert.equal(`${requestUrl.origin}${requestUrl.pathname}`, `${SHOPIER_API_BASE_URL}${SHOPIER_REFUNDS_PATH}`);
            assert.equal(requestUrl.searchParams.get("orderId"), orderId);
            assert.equal(requestUrl.searchParams.get("limit"), "2");
            return new Response(JSON.stringify([refund]));
        },
    });
    assert.equal(listed.length, 1);

    await expectCode(() => createShopierRefund({
        orderId, amountMinor: 1_250, currency: "TRY", note: "Test tam iade.", credentials,
        fetchImpl: async () => new Response(JSON.stringify({ ...refund, total: "12.51" })),
    }), "invalid_provider_response");
    await expectCode(() => createShopierRefund({
        orderId, amountMinor: 1_250, currency: "TRY", note: "Test tam iade.", credentials,
        fetchImpl: async () => new Response("{}", { status: 429 }),
    }), "provider_rate_limited");

    const environment = {
        SHOPIER_CHECKOUT_MODE: "live", SHOPIER_REFUND_MODE: "live",
        SHOPIER_PERSONAL_ACCESS_TOKEN: token, SHOPIER_LIVE_ACCEPTANCE_RECORDED: "true",
        SHOPIER_LIVE_ACCEPTANCE_EVIDENCE_SHA256: `sha256:${"a".repeat(64)}`,
    };
    assert.equal(getPaymentRefundReadiness("shopier_v2", environment).ready, true);
    assert.equal(createPaymentRefundAdapter({ provider: "shopier_v2", environment })?.provider, "shopier_v2");
    assert.equal(getPaymentRefundReadiness("shopier_v2", { ...environment, SHOPIER_REFUND_MODE: "disabled" }).ready, false);
    console.log("Shopier refund adapter and readiness checks passed");
}

void run();
