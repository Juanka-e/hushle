import assert from "node:assert/strict";
import { createHmac } from "node:crypto";
import { readFileSync } from "node:fs";
import {
    PAYTR_REFUND_ENDPOINT,
    PaytrAdapterError,
    buildPaytrRefundForm,
    createPaymentRefundAdapter,
    getPaymentRefundReadiness,
    queryPaytrPaymentStatus,
    requestPaytrRefund,
} from "@hushle/platform-payments";

const credentials = {
    merchantId: "123456",
    merchantKey: "refund-test-key",
    merchantSalt: "refund-test-salt",
};
const request = {
    merchantOrderId: "ORDER20260809001",
    amountMinor: 11_97,
    referenceNo: "RF20260809001",
};

async function expectCode(action: () => Promise<unknown>, code: string): Promise<void> {
    await assert.rejects(action, (error: unknown) => {
        assert.ok(error instanceof PaytrAdapterError);
        assert.equal(error.code, code);
        return true;
    });
}

async function main(): Promise<void> {
    const form = buildPaytrRefundForm({ ...request, credentials });
    const expectedToken = createHmac("sha256", credentials.merchantKey)
        .update(`${credentials.merchantId}${request.merchantOrderId}11.97${credentials.merchantSalt}`, "utf8")
        .digest("base64");
    assert.equal(form.get("return_amount"), "11.97");
    assert.equal(form.get("reference_no"), request.referenceNo);
    assert.equal(form.get("paytr_token"), expectedToken);
    assert.equal(form.has("merchant_key"), false);
    assert.equal(form.has("merchant_salt"), false);

    let capturedUrl = "";
    let capturedBody = "";
    const result = await requestPaytrRefund({
        ...request,
        credentials,
        fetchImpl: async (url, init) => {
            capturedUrl = String(url);
            capturedBody = String(init?.body);
            return new Response(JSON.stringify({
                status: "success",
                is_test: "1",
                merchant_oid: request.merchantOrderId,
                return_amount: "11.97",
                reference_no: request.referenceNo,
            }), { status: 200 });
        },
    });
    assert.equal(capturedUrl, PAYTR_REFUND_ENDPOINT);
    assert.equal(new URLSearchParams(capturedBody).get("merchant_oid"), request.merchantOrderId);
    assert.deepEqual(result, { ...request, testMode: true });

    await expectCode(() => requestPaytrRefund({
        ...request,
        credentials,
        fetchImpl: async () => new Response(JSON.stringify({
            status: "error",
            err_no: "006",
            err_msg: "provider detail must not escape",
        })),
    }), "provider_rejected");
    await expectCode(() => requestPaytrRefund({
        ...request,
        credentials,
        fetchImpl: async () => new Response(JSON.stringify({
            status: "success",
            is_test: 1,
            merchant_oid: request.merchantOrderId,
            return_amount: "1.00",
            reference_no: request.referenceNo,
        })),
    }), "invalid_provider_response");
    await expectCode(() => requestPaytrRefund({
        ...request,
        credentials,
        fetchImpl: async () => new Response("x".repeat(16_385)),
    }), "invalid_provider_response");
    await expectCode(async () => buildPaytrRefundForm({
        ...request,
        referenceNo: "bad-reference-with-dashes",
        credentials,
    }), "invalid_request");

    const environment = {
        PAYTR_REFUND_MODE: "sandbox",
        PAYTR_CHECKOUT_MODE: "sandbox",
        PAYTR_MERCHANT_ID: credentials.merchantId,
        PAYTR_MERCHANT_KEY: credentials.merchantKey,
        PAYTR_MERCHANT_SALT: credentials.merchantSalt,
    };
    assert.equal(getPaymentRefundReadiness("paytr", {}).ready, false);
    assert.equal(getPaymentRefundReadiness("paytr", { ...environment, PAYTR_REFUND_MODE: "live" }).ready, false);
    assert.equal(getPaymentRefundReadiness("paytr", { ...environment, PAYTR_MERCHANT_ID: "not-numeric" }).ready, false);
    assert.equal(getPaymentRefundReadiness("paytr", environment).ready, true);
    const adapter = createPaymentRefundAdapter({
        provider: "paytr",
        environment,
        fetchImpl: async () => new Response(JSON.stringify({
            status: "success",
            is_test: true,
            merchant_oid: request.merchantOrderId,
            return_amount: "11.97",
            reference_no: request.referenceNo,
        })),
    });
    assert.equal(adapter?.provider, "paytr");
    assert.deepEqual(await adapter?.refund({ ...request, currency: "try" }), {
        provider: "paytr",
        currency: "TRY",
        ...request,
        providerRefundReference: request.referenceNo,
        status: "succeeded",
        testMode: true,
    });
    assert.equal(createPaymentRefundAdapter({ provider: "stripe", environment }), null);
    assert.deepEqual(getPaymentRefundReadiness("stripe", environment), {
        provider: "stripe",
        mode: "disabled",
        ready: false,
        issues: ["refund_adapter_unavailable"],
    });
    const status = await queryPaytrPaymentStatus({
        merchantOrderId: request.merchantOrderId,
        credentials,
        fetchImpl: async () => new Response(JSON.stringify({
            status: "success",
            payment_amount: "11.97",
            payment_total: "11.97",
            currency: "TL",
            test_mode: "1",
            returns: [{
                return_amount: "11.97",
                reference_no: request.referenceNo,
                date_completed: "2026-08-09 20:00:00",
            }],
        })),
    });
    assert.equal(status.status, "success");
    if (status.status === "success") {
        assert.deepEqual(status.refunds, [{ referenceNo: request.referenceNo, amountMinor: 1_197, completed: true }]);
    }

    const appSources = [
        readFileSync("apps/web/src/app/api/admin/payments/[id]/reversal/route.ts", "utf8"),
        readFileSync("apps/web/src/app/api/admin/payments/reversal-requests/[id]/review/route.ts", "utf8"),
        readFileSync("apps/web/src/app/api/admin/payments/reversal-requests/[id]/recover/route.ts", "utf8"),
    ].join("\n");
    assert.doesNotMatch(appSources, /requestPaytrRefund/);
    assert.match(appSources, /getPaymentRefundReadiness/);
    assert.match(appSources, /approveProviderApiRefundRequest/);
    assert.match(appSources, /recoverProviderApiRefundRequest/);
    console.log("PayTR refund adapter and guarded orchestration checks passed");
}

main().catch((error) => {
    console.error(error);
    process.exitCode = 1;
});
