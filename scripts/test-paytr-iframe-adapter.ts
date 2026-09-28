import assert from "node:assert/strict";
import { createHmac } from "node:crypto";
import {
    PAYTR_IFRAME_TOKEN_ENDPOINT,
    PaytrAdapterError,
    PaymentWebhookError,
    buildPaytrCallbackHash,
    buildPaytrIframeForm,
    createPaytrWebhookVerifier,
    requestPaytrIframeToken,
} from "@hushle/platform-payments";

const credentials = {
    merchantId: "123456",
    merchantKey: "test-merchant-key",
    merchantSalt: "test-merchant-salt",
};

const request = {
    merchantOrderId: "ORDER20260808001",
    userIp: "203.0.113.10",
    email: "player@example.com",
    amountMinor: 14990,
    currency: "TRY" as const,
    basket: [
        { name: "Neon Kart Paketi", unitAmountMinor: 14990, quantity: 1 },
    ],
    fullName: "Test Player",
    address: "Test Mahallesi, Istanbul",
    phone: "+905551112233",
    successUrl: "https://example.com/checkout/success",
    failureUrl: "https://example.com/checkout/failure",
    noInstallment: true,
    maxInstallment: 0,
    testMode: true,
    language: "tr" as const,
};

function independentHmac(message: string): string {
    return createHmac("sha256", credentials.merchantKey)
        .update(message, "utf8")
        .digest("base64");
}

async function expectCode(
    action: () => Promise<unknown>,
    ErrorType: typeof PaytrAdapterError | typeof PaymentWebhookError,
    code: string
): Promise<void> {
    await assert.rejects(action, (error: unknown) => {
        assert.ok(error instanceof ErrorType);
        assert.equal(error.code, code);
        assert.equal(error.message, code);
        return true;
    });
}

async function main(): Promise<void> {
    const form = buildPaytrIframeForm(request, credentials);
    const basket = Buffer.from(JSON.stringify([["Neon Kart Paketi", "149.90", 1]]), "utf8")
        .toString("base64");
    const hashInput = [
        credentials.merchantId,
        request.userIp,
        request.merchantOrderId,
        request.email,
        request.amountMinor.toString(),
        basket,
        "1",
        "0",
        "TL",
        "1",
    ].join("");

    assert.equal(form.get("user_basket"), basket);
    assert.equal(form.get("currency"), "TL");
    assert.equal(
        form.get("paytr_token"),
        independentHmac(`${hashInput}${credentials.merchantSalt}`)
    );
    assert.equal(form.has("merchant_key"), false);
    assert.equal(form.has("merchant_salt"), false);

    let capturedUrl = "";
    let capturedBody = "";
    const tokenResult = await requestPaytrIframeToken({
        request,
        credentials,
        fetchImpl: async (url, init) => {
            capturedUrl = String(url);
            capturedBody = String(init?.body);
            return new Response(JSON.stringify({ status: "success", token: "sandbox-token/with-symbols" }), {
                status: 200,
                headers: { "content-type": "application/json" },
            });
        },
    });
    assert.equal(capturedUrl, PAYTR_IFRAME_TOKEN_ENDPOINT);
    assert.equal(new URLSearchParams(capturedBody).get("merchant_oid"), request.merchantOrderId);
    assert.equal(tokenResult.iframeUrl, "https://www.paytr.com/odeme/guvenli/sandbox-token%2Fwith-symbols");

    await expectCode(
        () => requestPaytrIframeToken({
            request,
            credentials,
            fetchImpl: async () => new Response(JSON.stringify({
                status: "failed",
                reason: "secret provider detail that must not escape",
            })),
        }),
        PaytrAdapterError,
        "provider_rejected"
    );
    await expectCode(
        () => requestPaytrIframeToken({
            request,
            credentials,
            fetchImpl: async () => new Response("x".repeat(16_385)),
        }),
        PaytrAdapterError,
        "invalid_provider_response"
    );
    await expectCode(
        async () => buildPaytrIframeForm({ ...request, amountMinor: 0 }, credentials),
        PaytrAdapterError,
        "invalid_request"
    );
    await expectCode(
        async () => buildPaytrIframeForm({ ...request, amountMinor: 14989 }, credentials),
        PaytrAdapterError,
        "invalid_request"
    );
    await expectCode(
        async () => buildPaytrIframeForm({ ...request, userIp: "not-an-ip" }, credentials),
        PaytrAdapterError,
        "invalid_request"
    );
    await expectCode(
        async () => buildPaytrIframeForm({
            ...request,
            successUrl: "http://attacker.example/checkout/success",
        }, credentials),
        PaytrAdapterError,
        "invalid_request"
    );

    const callbackFields = {
        merchant_oid: request.merchantOrderId,
        status: "success" as const,
        total_amount: request.amountMinor.toString(),
    };
    const callbackHash = buildPaytrCallbackHash({
        merchantOrderId: callbackFields.merchant_oid,
        status: callbackFields.status,
        totalAmount: callbackFields.total_amount,
        credentials,
    });
    assert.equal(
        callbackHash,
        independentHmac(
            `${callbackFields.merchant_oid}${credentials.merchantSalt}`
            + `${callbackFields.status}${callbackFields.total_amount}`
        )
    );

    const verifier = createPaytrWebhookVerifier(credentials);
    assert.deepEqual(verifier.acknowledgement, {
        status: 200,
        contentType: "text/plain; charset=utf-8",
        body: "OK",
    });
    const validBody = new URLSearchParams({
        ...callbackFields,
        hash: callbackHash,
        currency: "TL",
        payment_type: "card",
        test_mode: "1",
    }).toString();
    const verified = await verifier.verify({
        rawBody: Buffer.from(validBody),
        headers: {},
    });
    assert.equal(verified.providerEventId, request.merchantOrderId);
    assert.equal(verified.outcome, "payment_succeeded");
    assert.equal(verified.amountMinor, request.amountMinor);
    assert.equal(verified.currency, "TRY");
    assert.equal(verified.metadata?.testMode, true);

    const tampered = new URLSearchParams(validBody);
    tampered.set("total_amount", "1");
    await expectCode(
        () => verifier.verify({ rawBody: Buffer.from(tampered.toString()), headers: {} }),
        PaymentWebhookError,
        "invalid_signature"
    );

    const duplicate = `${validBody}&merchant_oid=OTHERORDER`;
    await expectCode(
        () => verifier.verify({ rawBody: Buffer.from(duplicate), headers: {} }),
        PaymentWebhookError,
        "invalid_event"
    );
    await expectCode(
        () => verifier.verify({ rawBody: Buffer.alloc(16_385, 65), headers: {} }),
        PaymentWebhookError,
        "invalid_event"
    );
    await expectCode(
        () => verifier.verify({ rawBody: Uint8Array.from([0xff, 0xfe]), headers: {} }),
        PaymentWebhookError,
        "invalid_event"
    );

    console.log("PayTR iFrame adapter contract tests passed.");
}

main().catch((error) => {
    console.error(error);
    process.exitCode = 1;
});
