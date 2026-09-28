import assert from "node:assert/strict";
import { createHmac } from "node:crypto";
import {
    PaymentWebhookError,
    buildIyzicoHppWebhookSignatureV3,
    createIyzicoHppWebhookVerifier,
    getPaymentWebhookVerifier,
} from "@hushle/platform-payments";

async function run(): Promise<void> {
    const secretKey = "sandbox-webhook-secret-key";
    const merchantId = "3404590";
    const payload = {
        paymentConversationId: "b807f23b-e0e5-4d30-a325-a9ff29eb2651",
        merchantId: Number(merchantId),
        status: "SUCCESS",
        token: "9895e0e6-cd7e-4635-9c33-fe52c337de09",
        iyziReferenceCode: "a5450da6-6741-431b-bfcf-2ad147b65fe0",
        iyziEventType: "CHECKOUT_FORM_AUTH",
        iyziEventTime: 1_766_733_201_159,
        iyziPaymentId: 28_157_797,
    } as const;
    const message = secretKey
        + payload.iyziEventType
        + String(payload.iyziPaymentId)
        + payload.token
        + payload.paymentConversationId
        + payload.status;
    const expectedSignature = createHmac("sha256", secretKey).update(message, "utf8").digest("hex");

    assert.equal(buildIyzicoHppWebhookSignatureV3({
        secretKey,
        iyziEventType: payload.iyziEventType,
        iyziPaymentId: String(payload.iyziPaymentId),
        token: payload.token,
        paymentConversationId: payload.paymentConversationId,
        status: payload.status,
    }), expectedSignature);

    const verifier = createIyzicoHppWebhookVerifier({ secretKey, merchantId });
    const rawBody = new TextEncoder().encode(JSON.stringify(payload));
    const verified = await verifier.verify({
        rawBody,
        headers: { "x-iyz-signature-v3": expectedSignature.toUpperCase() },
    });
    assert.equal(verified.providerEventId, payload.iyziReferenceCode);
    assert.equal(verified.providerOrderReference, payload.paymentConversationId);
    assert.equal(verified.providerPaymentReference, String(payload.iyziPaymentId));
    assert.equal(verified.outcome, "payment_succeeded");
    assert.equal(verified.signatureVersion, "v3");
    assert.match(String(verified.metadata?.tokenSha256), /^[a-f0-9]{64}$/);
    assert.equal(JSON.stringify(verified).includes(payload.token), false);

    await assert.rejects(
        () => verifier.verify({ rawBody, headers: { "x-iyz-signature-v2": expectedSignature } }),
        (error: unknown) => error instanceof PaymentWebhookError && error.code === "invalid_signature"
    );
    await assert.rejects(
        () => verifier.verify({
            rawBody: new TextEncoder().encode(JSON.stringify({ ...payload, status: "FAILURE" })),
            headers: { "x-iyz-signature-v3": expectedSignature },
        }),
        (error: unknown) => error instanceof PaymentWebhookError && error.code === "invalid_signature"
    );
    assert.throws(
        () => createIyzicoHppWebhookVerifier({ secretKey, merchantId: "other" }),
        (error: unknown) => error instanceof PaymentWebhookError && error.code === "invalid_signature"
    );

    assert.equal(getPaymentWebhookVerifier("iyzico", {
        IYZICO_SECRET_KEY: secretKey,
        IYZICO_MERCHANT_ID: merchantId,
        IYZICO_CHECKOUT_MODE: "sandbox",
        IYZICO_WEBHOOK_MODE: "disabled",
    }), null);
    assert.ok(getPaymentWebhookVerifier("iyzico", {
        IYZICO_SECRET_KEY: secretKey,
        IYZICO_MERCHANT_ID: merchantId,
        IYZICO_CHECKOUT_MODE: "sandbox",
        IYZICO_WEBHOOK_MODE: "sandbox",
    }));
    assert.equal(getPaymentWebhookVerifier("iyzico", {
        IYZICO_SECRET_KEY: secretKey,
        IYZICO_MERCHANT_ID: "",
        IYZICO_CHECKOUT_MODE: "sandbox",
        IYZICO_WEBHOOK_MODE: "sandbox",
    }), null);

    console.log("iyzico Signature V3 HPP webhook contract checks passed");
    }

void run();
