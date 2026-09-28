import { createHash, createHmac, timingSafeEqual } from "node:crypto";
import { z } from "zod";
import {
    PaymentWebhookError,
    type PaymentWebhookVerifier,
    type VerifiedPaymentWebhook,
} from "../webhook-inbox";

const MAX_WEBHOOK_BYTES = 64 * 1024;
const signatureSchema = z.string().regex(/^[a-fA-F0-9]{64}$/);
const boundedText = (max: number) => z.string().min(1).max(max);
const integerText = z.union([
    z.string().regex(/^\d{1,19}$/),
    z.number().int().nonnegative().safe().transform(String),
]);
const hppWebhookSchema = z.object({
    paymentConversationId: z.string().uuid(),
    merchantId: integerText,
    status: z.enum([
        "FAILURE",
        "SUCCESS",
        "INIT_THREEDS",
        "CALLBACK_THREEDS",
        "BKM_POS_SELECTED",
        "INIT_APM",
        "INIT_BANK_TRANSFER",
        "INIT_CREDIT",
        "PENDING_CREDIT",
        "INIT_CONTACTLESS",
    ]),
    token: boundedText(191),
    iyziReferenceCode: boundedText(191),
    iyziEventType: z.literal("CHECKOUT_FORM_AUTH"),
    iyziEventTime: z.number().int().min(1_577_836_800_000).max(4_102_444_800_000).safe(),
    iyziPaymentId: integerText,
});

function parseSecretKey(secretKey: string): string {
    const normalized = secretKey.trim();
    if (!normalized.startsWith("sandbox-") || normalized.length > 512) {
        throw new PaymentWebhookError("invalid_signature");
    }
    return normalized;
}

function parseMerchantId(merchantId: string): string {
    const normalized = merchantId.trim();
    if (!/^\d{1,19}$/.test(normalized)) throw new PaymentWebhookError("invalid_signature");
    return normalized;
}

function safeHexEqual(submitted: string, expected: string): boolean {
    const parsed = signatureSchema.safeParse(submitted);
    if (!parsed.success) return false;
    const submittedBuffer = Buffer.from(parsed.data.toLowerCase(), "hex");
    const expectedBuffer = Buffer.from(expected, "hex");
    return submittedBuffer.length === expectedBuffer.length
        && timingSafeEqual(submittedBuffer, expectedBuffer);
}

export function buildIyzicoHppWebhookSignatureV3(input: {
    secretKey: string;
    iyziEventType: string;
    iyziPaymentId: string;
    token: string;
    paymentConversationId: string;
    status: string;
}): string {
    const secretKey = parseSecretKey(input.secretKey);
    const message = secretKey
        + input.iyziEventType
        + input.iyziPaymentId
        + input.token
        + input.paymentConversationId
        + input.status;
    return createHmac("sha256", secretKey).update(message, "utf8").digest("hex");
}

function parseIyzicoHppWebhook(input: {
    rawBody: Uint8Array;
    headers: Readonly<Record<string, string>>;
    secretKey: string;
    merchantId: string;
}): VerifiedPaymentWebhook {
    if (input.rawBody.byteLength === 0 || input.rawBody.byteLength > MAX_WEBHOOK_BYTES) {
        throw new PaymentWebhookError("invalid_event");
    }
    let raw: unknown;
    try {
        const body = new TextDecoder("utf-8", { fatal: true }).decode(input.rawBody);
        raw = JSON.parse(body);
    } catch {
        throw new PaymentWebhookError("invalid_event");
    }
    const parsed = hppWebhookSchema.safeParse(raw);
    if (!parsed.success) throw new PaymentWebhookError("invalid_event");
    const event = parsed.data;
    if (event.merchantId !== input.merchantId) throw new PaymentWebhookError("invalid_signature");
    const submittedSignature = input.headers["x-iyz-signature-v3"] ?? "";
    const expectedSignature = buildIyzicoHppWebhookSignatureV3({
        secretKey: input.secretKey,
        iyziEventType: event.iyziEventType,
        iyziPaymentId: event.iyziPaymentId,
        token: event.token,
        paymentConversationId: event.paymentConversationId,
        status: event.status,
    });
    if (!safeHexEqual(submittedSignature, expectedSignature)) {
        throw new PaymentWebhookError("invalid_signature");
    }

    return {
        providerEventId: event.iyziReferenceCode,
        eventType: event.iyziEventType,
        outcome: event.status === "SUCCESS"
            ? "payment_succeeded"
            : event.status === "FAILURE"
                ? "payment_failed"
                : "ignored",
        signatureVersion: "v3",
        providerOrderReference: event.paymentConversationId,
        providerPaymentReference: event.iyziPaymentId,
        metadata: {
            tokenSha256: createHash("sha256").update(event.token, "utf8").digest("hex"),
            merchantId: event.merchantId,
        },
        occurredAt: new Date(event.iyziEventTime),
    };
}

export function createIyzicoHppWebhookVerifier(input: {
    secretKey: string;
    merchantId: string;
}): PaymentWebhookVerifier {
    const secretKey = parseSecretKey(input.secretKey);
    const merchantId = parseMerchantId(input.merchantId);
    return {
        provider: "iyzico",
        acknowledgement: { status: 200, contentType: "text/plain; charset=utf-8", body: "OK" },
        async verify({ rawBody, headers }) {
            return parseIyzicoHppWebhook({ rawBody, headers, secretKey, merchantId });
        },
    };
}
