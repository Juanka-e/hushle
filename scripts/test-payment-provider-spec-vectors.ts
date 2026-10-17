import assert from "node:assert/strict";
import { createHmac, randomUUID } from "node:crypto";
import {
    IYZICO_CF_RETRIEVE_PATH,
    IyzicoAdapterError,
    PaymentWebhookError,
    buildIyzicoCfInitializeResponseSignature,
    buildIyzicoCfRetrieveResponseSignature,
    buildIyzicoResponseSignature,
    buildIyzicoV2Authorization,
    buildPaytrCallbackHash,
    buildPaytrIframeForm,
    buildPaytrRefundForm,
    buildPaytrStatusQueryForm,
    createIyzicoHppWebhookVerifier,
    createPaytrWebhookVerifier,
    encodeIyzicoV2Authorization,
    isAllowedShopierHostedUrl,
    listShopierCustomListings,
    queryPaytrPaymentStatus,
    retrieveIyzicoCheckoutForm,
} from "@hushle/platform-payments";

// Contract vectors that pin the provider crypto and wire formats to the official docs.
// "Official" vectors are copied verbatim from the provider documentation (input and
// expected output). Where a provider publishes only the formula, the expected values
// were computed once with an independent Python implementation of the documented PHP
// sample and are hard-coded here, so any drift in our serialization fails loudly.

async function expectIyzicoCode(action: () => Promise<unknown>, code: string): Promise<void> {
    await assert.rejects(action, (error: unknown) => {
        assert.ok(error instanceof IyzicoAdapterError);
        assert.equal(error.code, code);
        return true;
    });
}

function jsonResponse(value: unknown): Response {
    return new Response(JSON.stringify(value), {
        status: 200,
        headers: { "content-type": "application/json" },
    });
}

async function iyzicoOfficialVectors(): Promise<void> {
    // docs.iyzico.com/en/advanced/response-signature-validation ("Sample Signature for
    // Non-3DS Endpoint"): secretKey, ":" separator and the documented response values.
    const docSecretKey = "sandbox-qaIiLIxhjMgx3LSKIVvp6j17NunHOFtD";
    assert.equal(
        buildIyzicoResponseSignature(docSecretKey, [
            "22416032",
            "TRY",
            "basketId",
            "conversationId",
            "10.5",
            "10.5",
        ]),
        "836c3a6c8db86c81043f2ca74edb13518b54a813f454f8dd762f0dd658610173"
    );

    // Same page, "Trailing Zero" table: price values are stripped of trailing zeros
    // before they enter the signature.
    const trailingZeroTable: Array<[string, string]> = [
        ["10", "10"],
        ["10.0", "10"],
        ["10.5", "10.5"],
        ["10.50", "10.5"],
        ["10.510", "10.51"],
        ["10.5105", "10.5105"],
        ["10.51050", "10.5105"],
    ];
    const retrieveFields = {
        secretKey: docSecretKey,
        paymentStatus: "SUCCESS",
        paymentId: "22416032",
        currency: "TRY",
        basketId: "basketId",
        conversationId: "conversationId",
        token: "a5b67652-c24a-4347-b61e-6c957bf30f1b",
    };
    for (const [received, normalized] of trailingZeroTable) {
        assert.equal(
            buildIyzicoCfRetrieveResponseSignature({
                ...retrieveFields,
                paidPrice: received,
                price: received,
            }),
            // CF "Retrieve Payment Result" parameter order: paymentStatus, paymentId,
            // currency, basketId, conversationId, paidPrice, price, token.
            buildIyzicoResponseSignature(docSecretKey, [
                "SUCCESS",
                "22416032",
                "TRY",
                "basketId",
                "conversationId",
                normalized,
                normalized,
                retrieveFields.token,
            ]),
            `trailing zero rule for ${received}`
        );
    }
    // Number values (the CF sample returns "price": 5.20000000) follow the same rule.
    assert.equal(
        buildIyzicoCfRetrieveResponseSignature({ ...retrieveFields, paidPrice: 5.2, price: 5.2 }),
        buildIyzicoCfRetrieveResponseSignature({ ...retrieveFields, paidPrice: "5.20000000", price: "5.20" })
    );
    // CF Initialize parameter order: conversationId, token.
    assert.equal(
        buildIyzicoCfInitializeResponseSignature({
            secretKey: docSecretKey,
            conversationId: "conversationId",
            token: retrieveFields.token,
        }),
        buildIyzicoResponseSignature(docSecretKey, ["conversationId", retrieveFields.token])
    );

    // docs.iyzico.com/en/getting-started/preliminaries/authentication/hmacsha256-auth:
    // the documented header example and the Postman pre-request sample.
    assert.equal(
        encodeIyzicoV2Authorization({
            apiKey: "sandbox-l9Md1Gj3IYcmu4NdaWxaSUoCoX7DC5RA",
            randomKey: "123456789",
            signature: "079df4b2426fc7f4208d8f22fbc0349794019f8ce2b0711de7808b4874f4e796",
        }),
        "IYZWSv2 YXBpS2V5OnNhbmRib3gtbDlNZDFHajNJWWNtdTROZGFXeGFTVW9Db1g3REM1UkEmcmFuZG9tS2V5OjEyMzQ1Njc4OSZzaWduYXR1cmU6MDc5ZGY0YjI0MjZmYzdmNDIwOGQ4ZjIyZmJjMDM0OTc5NDAxOWY4Y2UyYjA3MTFkZTc4MDhiNDg3NGY0ZTc5Ng=="
    );
    assert.equal(
        encodeIyzicoV2Authorization({
            apiKey: "sandbox-3uHv0LccjcWDyFHTvJpiACKPcJwbczmZ",
            randomKey: "1722246017090123456789",
            signature: "91e491486d3aa951b4f387cc93d67fc754c4729af95344b694435f56447819e9",
        }),
        "IYZWSv2 YXBpS2V5OnNhbmRib3gtM3VIdjBMY2NqY1dEeUZIVHZKcGlBQ0tQY0p3YmN6bVomcmFuZG9tS2V5OjE3MjIyNDYwMTcwOTAxMjM0NTY3ODkmc2lnbmF0dXJlOjkxZTQ5MTQ4NmQzYWE5NTFiNGYzODdjYzkzZDY3ZmM3NTRjNDcyOWFmOTUzNDRiNjk0NDM1ZjU2NDQ3ODE5ZTk="
    );
    // Step 1 (encryptedData) = HMACSHA256(randomKey + uri.path + request.body, secretKey), hex.
    const testSecret = "sandbox-spec-vector-secret";
    const body = "{\"binNumber\":\"589004\"}";
    const header = buildIyzicoV2Authorization({
        apiKey: "sandbox-3uHv0LccjcWDyFHTvJpiACKPcJwbczmZ",
        secretKey: testSecret,
        randomKey: "1722246017090123456789",
        uriPath: "/payment/bin/check",
        requestBody: body,
    });
    assert.equal(
        header,
        encodeIyzicoV2Authorization({
            apiKey: "sandbox-3uHv0LccjcWDyFHTvJpiACKPcJwbczmZ",
            randomKey: "1722246017090123456789",
            signature: createHmac("sha256", testSecret)
                .update(`1722246017090123456789/payment/bin/check${body}`, "utf8")
                .digest("hex"),
        })
    );
}

async function iyzicoRetrievePriceFormats(): Promise<void> {
    const credentials = {
        apiKey: "sandbox-spec-vector-api-key",
        secretKey: "sandbox-spec-vector-secret-key",
    };
    const conversationId = randomUUID();
    const token = "3ee2d355-da4d-47ce-bd3d-13d8c1854128";
    const randomKey = "17222460170901234567890000";

    function signedRetrieve(price: string | number, paidPrice: string | number) {
        return {
            status: "success",
            locale: "tr",
            systemTime: 1_687_113_618_054,
            conversationId,
            price,
            paidPrice,
            installment: 1,
            paymentId: "19831123",
            fraudStatus: 1,
            basketId: conversationId,
            currency: "TRY",
            token,
            paymentStatus: "SUCCESS",
            signature: buildIyzicoCfRetrieveResponseSignature({
                secretKey: credentials.secretKey,
                paymentStatus: "SUCCESS",
                paymentId: "19831123",
                currency: "TRY",
                basketId: conversationId,
                conversationId,
                paidPrice,
                price,
                token,
            }),
        };
    }

    async function retrieve(price: string | number, paidPrice: string | number) {
        let capturedHeaders: Headers | null = null;
        let capturedUrl = "";
        const result = await retrieveIyzicoCheckoutForm({
            conversationId,
            token,
            credentials,
            randomKey,
            fetchImpl: async (url, init) => {
                capturedUrl = String(url);
                capturedHeaders = new Headers(init?.headers);
                return jsonResponse(signedRetrieve(price, paidPrice));
            },
        });
        assert.equal(capturedUrl.endsWith(IYZICO_CF_RETRIEVE_PATH), true);
        // The x-iyzi-rnd header carries the same randomKey that was signed.
        assert.equal(capturedHeaders!.get("x-iyzi-rnd"), randomKey);
        return result;
    }

    // The CF retrieve sample returns JSON numbers with eight decimals.
    const numeric = await retrieve(5.2, 5.2);
    assert.equal(numeric.amountMinor, 520);
    assert.equal(numeric.paidAmountMinor, 520);
    // The signature page shows string prices with trailing zeros ("10.50", "10.510");
    // a correctly signed response must not be rejected for its zero padding.
    const padded = await retrieve("5.20000000", "5.20");
    assert.equal(padded.amountMinor, 520);
    assert.equal(padded.paidAmountMinor, 520);
    const threeDigits = await retrieve("10.510", "10.5100");
    assert.equal(threeDigits.amountMinor, 1051);
    const whole = await retrieve("10", "10.0");
    assert.equal(whole.amountMinor, 1000);
    assert.equal(whole.paidAmountMinor, 1000);
    // Sub-minor amounts cannot be represented in kuruş and must stay fail-closed.
    await expectIyzicoCode(() => retrieve("10.5105", "10.5105"), "invalid_provider_response");
    await expectIyzicoCode(() => retrieve("10.001", "10.001"), "invalid_provider_response");
    await expectIyzicoCode(() => retrieve("1e3", "1e3"), "invalid_provider_response");
    await expectIyzicoCode(() => retrieve("0.00", "0.00"), "invalid_provider_response");
}

async function iyzicoWebhookFormats(): Promise<void> {
    // docs.iyzico.com/en/advanced/webhook: only the HPP format carries a token. A Direct
    // format notification (API_AUTH, no token) must not be accepted by the CF verifier.
    const secretKey = "sandbox-spec-vector-webhook-secret";
    const verifier = createIyzicoHppWebhookVerifier({ secretKey, merchantId: "3404590" });
    const direct = {
        paymentConversationId: randomUUID(),
        merchantId: 3404590,
        paymentId: 28157248,
        status: "SUCCESS",
        iyziReferenceCode: "97f61d20-e66f-4120-82e9-92f4a183370a",
        iyziEventType: "API_AUTH",
        iyziEventTime: 1_766_730_778_396,
        iyziPaymentId: 28157248,
    };
    const directSignature = createHmac("sha256", secretKey)
        .update(secretKey + direct.iyziEventType + direct.paymentId + direct.paymentConversationId + direct.status)
        .digest("hex");
    await assert.rejects(
        () => verifier.verify({
            rawBody: new TextEncoder().encode(JSON.stringify(direct)),
            headers: { "x-iyz-signature-v3": directSignature },
        }),
        (error: unknown) => error instanceof PaymentWebhookError && error.code === "invalid_event"
    );
}

const PAYTR_CREDENTIALS = {
    merchantId: "123456",
    merchantKey: "HUSHLE-DOC-VECTOR-KEY",
    merchantSalt: "HUSHLE-DOC-VECTOR-SALT",
};
const PAYTR_OID = "DOCVECTOR20261015";

async function paytrDocumentedFormulas(): Promise<void> {
    // dev.paytr.com/iframe-api/iframe-api-1-adim Node.js sample basket, priced in
    // kuruş for our adapter (18.00, 2 x 33.25, 45.42 => 129.92 TL => 12992).
    const form = buildPaytrIframeForm({
        merchantOrderId: PAYTR_OID,
        userIp: "203.0.113.10",
        email: "player@example.com",
        amountMinor: 12_992,
        currency: "TRY",
        basket: [
            { name: "Örnek Ürün 1", unitAmountMinor: 1_800, quantity: 1 },
            { name: "Örnek Ürün 2", unitAmountMinor: 3_325, quantity: 2 },
            { name: "Örnek Ürün 3", unitAmountMinor: 4_542, quantity: 1 },
        ],
        fullName: "Test Oyuncu",
        address: "Test Mahallesi Istanbul",
        phone: "+905551112233",
        successUrl: "https://example.com/checkout/success",
        failureUrl: "https://example.com/checkout/failure",
        noInstallment: true,
        maxInstallment: 0,
        testMode: true,
        language: "tr",
    }, PAYTR_CREDENTIALS);
    // base64(JSON.stringify([["Örnek Ürün 1","18.00",1],["Örnek Ürün 2","33.25",2],
    // ["Örnek Ürün 3","45.42",1]])) exactly as the official Node.js sample builds it.
    assert.equal(
        form.get("user_basket"),
        "W1siw5ZybmVrIMOccsO8biAxIiwiMTguMDAiLDFdLFsiw5ZybmVrIMOccsO8biAyIiwiMzMuMjUiLDJdLFsiw5ZybmVrIMOccsO8biAzIiwiNDUuNDIiLDFdXQ=="
    );
    // payment_amount is an integer string in kuruş ("34.56 için 3456").
    assert.equal(form.get("payment_amount"), "12992");
    assert.equal(form.get("currency"), "TL");
    assert.equal(form.get("no_installment"), "1");
    assert.equal(form.get("max_installment"), "0");
    assert.equal(form.get("test_mode"), "1");
    // paytr_token = base64(HMAC-SHA256(merchant_id + user_ip + merchant_oid + email +
    // payment_amount + user_basket + no_installment + max_installment + currency +
    // test_mode + merchant_salt, merchant_key)).
    assert.equal(form.get("paytr_token"), "qm34M2kiyT4Eir5qWLA7QC0XzKJk371tiJgNSsaaFXw=");
    assert.equal(form.has("merchant_key"), false);
    assert.equal(form.has("merchant_salt"), false);

    // iframe-api-2-adim: hash = base64(HMAC-SHA256(merchant_oid + merchant_salt + status +
    // total_amount, merchant_key)); total_amount is multiplied by 100 ("34.56 => 3456").
    assert.equal(
        buildPaytrCallbackHash({
            merchantOrderId: PAYTR_OID,
            status: "success",
            totalAmount: "3456",
            credentials: PAYTR_CREDENTIALS,
        }),
        "4M6thDONKXPrLJTWpwyTpET6VP/+L3Bb9T9iJmmcnQo="
    );
    assert.equal(
        buildPaytrCallbackHash({
            merchantOrderId: PAYTR_OID,
            status: "failed",
            totalAmount: "3456",
            credentials: PAYTR_CREDENTIALS,
        }),
        "70W5pMhzm38GCpe144cYfBoAjridTA7FzH+Tx2duu4M="
    );
    const verifier = createPaytrWebhookVerifier(PAYTR_CREDENTIALS);
    // The merchant must answer with the plain text "OK" and nothing else.
    assert.deepEqual(verifier.acknowledgement, {
        status: 200,
        contentType: "text/plain; charset=utf-8",
        body: "OK",
    });
    const callback = new URLSearchParams({
        merchant_oid: PAYTR_OID,
        status: "success",
        total_amount: "3456",
        payment_amount: "3456",
        hash: "4M6thDONKXPrLJTWpwyTpET6VP/+L3Bb9T9iJmmcnQo=",
        payment_type: "card",
        currency: "TL",
        test_mode: "1",
    });
    const verified = await verifier.verify({
        rawBody: new TextEncoder().encode(callback.toString()),
        headers: {},
    });
    assert.equal(verified.amountMinor, 3456);
    assert.equal(verified.currency, "TRY");
    assert.equal(verified.outcome, "payment_succeeded");
    // The hash covers only oid, salt, status and amount; a flipped status must fail.
    callback.set("status", "failed");
    await assert.rejects(
        () => verifier.verify({ rawBody: new TextEncoder().encode(callback.toString()), headers: {} }),
        (error: unknown) => error instanceof PaymentWebhookError && error.code === "invalid_signature"
    );

    // durum-sorgu: paytr_token = base64(HMAC-SHA256(merchant_id + merchant_oid + merchant_salt)).
    const status = buildPaytrStatusQueryForm({ merchantOrderId: PAYTR_OID, credentials: PAYTR_CREDENTIALS });
    assert.equal(status.get("paytr_token"), "SbsGaXin4RFU9ayixobZMYjPo1UnFngTjKUFrBFS4Js=");
    assert.deepEqual([...status.keys()].sort(), ["merchant_id", "merchant_oid", "paytr_token"]);

    // iade-api: return_amount is a dot-separated decimal ("10.25"), token =
    // base64(HMAC-SHA256(merchant_id + merchant_oid + return_amount + merchant_salt)).
    const refund = buildPaytrRefundForm({
        merchantOrderId: PAYTR_OID,
        amountMinor: 1_025,
        referenceNo: "REFUNDVECTOR1",
        credentials: PAYTR_CREDENTIALS,
    });
    assert.equal(refund.get("return_amount"), "10.25");
    assert.equal(refund.get("paytr_token"), "T8+F9mRMi+MKmxltw+cQjs/Ifommaayw2T1Tpmhrb+A=");
    assert.equal(refund.get("reference_no"), "REFUNDVECTOR1");
}

async function paytrStatusQueryShapes(): Promise<void> {
    async function query(body: unknown) {
        return queryPaytrPaymentStatus({
            merchantOrderId: PAYTR_OID,
            credentials: PAYTR_CREDENTIALS,
            fetchImpl: async () => jsonResponse(body),
        });
    }
    // The durum-sorgu page shows both comma ("10,8") and dot ("9.76") decimals.
    const success = await query({
        status: "success",
        payment_amount: "10,8",
        payment_total: "9.76",
        currency: "TL",
        test_mode: "1",
        returns: [],
    });
    assert.equal(success.status, "success");
    if (success.status === "success") {
        assert.equal(success.paymentAmountMinor, 1080);
        assert.equal(success.paymentTotalMinor, 976);
        assert.equal(success.currency, "TRY");
        assert.equal(success.testMode, true);
    }
    // err_no 004: no successful payment for this merchant_oid.
    assert.deepEqual(await query({ status: "error", err_no: "004", err_msg: "Basarili odeme bulunamadi" }), {
        status: "error",
        errorCode: "004",
    });
    // The store table also documents "failed" as an error status.
    assert.deepEqual(await query({ status: "failed", err_no: "005", err_msg: "provider detail" }), {
        status: "error",
        errorCode: "005",
    });
}

async function shopierDocumentedFormats(): Promise<void> {
    // developer.shopier.com Product model sample URL.
    assert.equal(isAllowedShopierHostedUrl("https://www.shopier.com/689793", "689793"), true);
    assert.equal(isAllowedShopierHostedUrl("https://www.shopier.com/689793?ref=x", "689793"), false);
    assert.equal(isAllowedShopierHostedUrl("https://shopier.com.evil.example/689793"), false);
    // Date parameters use yyyy-MM-ddTHH:mm:ssZ (e.g. 2022-07-21T13:24:51+0300).
    let capturedUrl = "";
    await listShopierCustomListings({
        dateStart: new Date("2022-07-21T10:24:51.000Z"),
        dateEnd: new Date("2022-07-25T10:24:51.000Z"),
        credentials: { personalAccessToken: "shopier-spec-vector-token-0000" },
        fetchImpl: async (url) => {
            capturedUrl = String(url);
            return jsonResponse([]);
        },
    });
    const query = new URL(capturedUrl).searchParams;
    assert.equal(query.get("dateStart"), "2022-07-21T10:24:51+0000");
    assert.equal(query.get("dateEnd"), "2022-07-25T10:24:51+0000");
    // V8 parses the documented offset format used in order and refund payloads.
    assert.equal(new Date("2022-07-21T13:24:51+0300").toISOString(), "2022-07-21T10:24:51.000Z");
}

async function run(): Promise<void> {
    await iyzicoOfficialVectors();
    await iyzicoRetrievePriceFormats();
    await iyzicoWebhookFormats();
    await paytrDocumentedFormulas();
    await paytrStatusQueryShapes();
    await shopierDocumentedFormats();
    console.log("payment provider spec vector checks passed");
}

void run();
