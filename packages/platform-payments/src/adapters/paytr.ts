import { createHmac, timingSafeEqual } from "node:crypto";
import { isIP } from "node:net";
import { z } from "zod";
import type { PaymentWebhookVerifier, VerifiedPaymentWebhook } from "../webhook-inbox";
import { PaymentWebhookError } from "../webhook-inbox";

export const PAYTR_IFRAME_TOKEN_ENDPOINT = "https://www.paytr.com/odeme/api/get-token";
export const PAYTR_IFRAME_URL_PREFIX = "https://www.paytr.com/odeme/guvenli/";
export const PAYTR_STATUS_QUERY_ENDPOINT = "https://www.paytr.com/odeme/durum-sorgu";
export const PAYTR_REFUND_ENDPOINT = "https://www.paytr.com/odeme/iade";

const MAX_CALLBACK_BYTES = 16_384;
const DEFAULT_TIMEOUT_MS = 10_000;

const callbackUrlSchema = z.string().url().max(400).refine((value) => {
    const url = new URL(value);
    if (url.protocol === "https:") return true;
    return url.protocol === "http:"
        && (url.hostname === "localhost" || url.hostname === "127.0.0.1" || url.hostname === "::1");
}, "callback_url_requires_https");

const credentialsSchema = z.object({
    merchantId: z.string().trim().regex(/^\d{1,64}$/),
    merchantKey: z.string().min(1).max(512),
    merchantSalt: z.string().min(1).max(512),
});

const basketItemSchema = z.object({
    name: z.string().trim().min(1).max(160),
    unitAmountMinor: z.number().int().min(1).max(2_147_483_647),
    quantity: z.number().int().min(1).max(100),
});

export const paytrIframeRequestSchema = z.object({
    merchantOrderId: z.string().trim().regex(/^[A-Za-z0-9]{1,64}$/),
    userIp: z.string().trim().min(1).max(39).refine((value) => isIP(value) !== 0),
    email: z.string().trim().email().max(100).refine((value) => /^[\x20-\x7e]+$/.test(value)),
    amountMinor: z.number().int().min(1).max(2_147_483_647),
    currency: z.enum(["TRY", "EUR", "USD", "GBP", "RUB"]),
    basket: z.array(basketItemSchema).min(1).max(100),
    fullName: z.string().trim().min(1).max(60),
    address: z.string().trim().min(1).max(400),
    phone: z.string().trim().min(1).max(20),
    successUrl: callbackUrlSchema,
    failureUrl: callbackUrlSchema,
    noInstallment: z.boolean().default(true),
    maxInstallment: z.number().int().min(0).max(12).default(0),
    testMode: z.boolean().default(true),
    language: z.enum(["tr", "en"]).default("tr"),
}).superRefine((value, context) => {
    const basketTotal = value.basket.reduce(
        (total, item) => total + (item.unitAmountMinor * item.quantity),
        0
    );
    if (!Number.isSafeInteger(basketTotal) || basketTotal !== value.amountMinor) {
        context.addIssue({
            code: "custom",
            path: ["basket"],
            message: "basket_total_mismatch",
        });
    }
});

export type PaytrIframeRequest = z.input<typeof paytrIframeRequestSchema>;
export type PaytrCredentials = z.infer<typeof credentialsSchema>;

export class PaytrAdapterError extends Error {
    constructor(
        public readonly code:
            | "invalid_configuration"
            | "invalid_request"
            | "provider_timeout"
            | "provider_unavailable"
            | "provider_rejected"
            | "invalid_provider_response"
    ) {
        super(code);
        this.name = "PaytrAdapterError";
    }
}

function parseCredentials(input: PaytrCredentials): PaytrCredentials {
    const parsed = credentialsSchema.safeParse(input);
    if (!parsed.success) throw new PaytrAdapterError("invalid_configuration");
    return parsed.data;
}

function asPaytrCurrency(currency: z.infer<typeof paytrIframeRequestSchema>["currency"]): string {
    return currency === "TRY" ? "TL" : currency;
}

function formatMinorUnits(value: number): string {
    const whole = Math.floor(value / 100);
    const fraction = value % 100;
    return `${whole}.${fraction.toString().padStart(2, "0")}`;
}

const paytrRefundRequestSchema = z.object({
    merchantOrderId: z.string().trim().regex(/^[A-Za-z0-9]{1,64}$/),
    amountMinor: z.number().int().min(1).max(2_147_483_647),
    referenceNo: z.string().trim().regex(/^[A-Za-z0-9]{1,64}$/),
});

const paytrRefundResponseSchema = z.discriminatedUnion("status", [
    z.object({
        status: z.literal("success"),
        is_test: z.union([z.string(), z.number(), z.boolean()]),
        merchant_oid: z.string().trim().min(1).max(64),
        return_amount: z.union([z.string(), z.number()]),
        reference_no: z.string().trim().min(1).max(64),
    }),
    z.object({
        status: z.enum(["error", "failed"]),
        err_no: z.union([z.string(), z.number()]).optional(),
        err_msg: z.string().max(1000).optional(),
    }),
]);

export type PaytrRefundResult = {
    merchantOrderId: string;
    amountMinor: number;
    referenceNo: string;
    testMode: boolean;
};

export function buildPaytrRefundForm(input: {
    merchantOrderId: string;
    amountMinor: number;
    referenceNo: string;
    credentials: PaytrCredentials;
}): URLSearchParams {
    const parsed = paytrRefundRequestSchema.safeParse(input);
    if (!parsed.success) throw new PaytrAdapterError("invalid_request");
    const credentials = parseCredentials(input.credentials);
    const returnAmount = formatMinorUnits(parsed.data.amountMinor);
    const token = hmacBase64(
        `${credentials.merchantId}${parsed.data.merchantOrderId}${returnAmount}${credentials.merchantSalt}`,
        credentials.merchantKey
    );
    return new URLSearchParams({
        merchant_id: credentials.merchantId,
        merchant_oid: parsed.data.merchantOrderId,
        return_amount: returnAmount,
        paytr_token: token,
        reference_no: parsed.data.referenceNo,
    });
}

export async function requestPaytrRefund(input: {
    merchantOrderId: string;
    amountMinor: number;
    referenceNo: string;
    credentials: PaytrCredentials;
    fetchImpl?: typeof fetch;
    timeoutMs?: number;
}): Promise<PaytrRefundResult> {
    const request = paytrRefundRequestSchema.safeParse(input);
    if (!request.success) throw new PaytrAdapterError("invalid_request");
    const form = buildPaytrRefundForm({
        ...request.data,
        credentials: input.credentials,
    });
    const timeoutMs = Math.max(1_000, Math.min(input.timeoutMs ?? DEFAULT_TIMEOUT_MS, 30_000));
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), timeoutMs);
    try {
        const response = await (input.fetchImpl ?? fetch)(PAYTR_REFUND_ENDPOINT, {
            method: "POST",
            headers: { "content-type": "application/x-www-form-urlencoded" },
            body: form.toString(),
            signal: controller.signal,
        });
        if (!response.ok) throw new PaytrAdapterError("provider_unavailable");
        const declaredLength = Number(response.headers.get("content-length") ?? "0");
        if (declaredLength > 16_384) throw new PaytrAdapterError("invalid_provider_response");
        const body = await response.text();
        if (Buffer.byteLength(body, "utf8") > 16_384) {
            throw new PaytrAdapterError("invalid_provider_response");
        }
        let json: unknown;
        try {
            json = JSON.parse(body);
        } catch {
            throw new PaytrAdapterError("invalid_provider_response");
        }
        const parsed = paytrRefundResponseSchema.safeParse(json);
        if (!parsed.success) throw new PaytrAdapterError("invalid_provider_response");
        if (parsed.data.status !== "success") throw new PaytrAdapterError("provider_rejected");
        const amountMinor = parseProviderMoney(parsed.data.return_amount);
        const referenceNo = parsed.data.reference_no;
        if (
            parsed.data.merchant_oid !== request.data.merchantOrderId
            || amountMinor !== request.data.amountMinor
            || referenceNo !== request.data.referenceNo
        ) {
            throw new PaytrAdapterError("invalid_provider_response");
        }
        return {
            merchantOrderId: parsed.data.merchant_oid,
            amountMinor,
            referenceNo,
            testMode: parsed.data.is_test === true
                || parsed.data.is_test === 1
                || parsed.data.is_test === "1",
        };
    } catch (error) {
        if (error instanceof PaytrAdapterError) throw error;
        if (controller.signal.aborted) throw new PaytrAdapterError("provider_timeout");
        throw new PaytrAdapterError("provider_unavailable");
    } finally {
        clearTimeout(timeout);
    }
}

function buildBasket(items: z.infer<typeof basketItemSchema>[]): string {
    const basket = items.map((item) => [
        item.name,
        formatMinorUnits(item.unitAmountMinor),
        item.quantity,
    ]);
    return Buffer.from(JSON.stringify(basket), "utf8").toString("base64");
}

function hmacBase64(message: string, key: string): string {
    return createHmac("sha256", key).update(message, "utf8").digest("base64");
}

export function buildPaytrStatusQueryForm(input: {
    merchantOrderId: string;
    credentials: PaytrCredentials;
}): URLSearchParams {
    if (!/^[A-Za-z0-9]{1,64}$/.test(input.merchantOrderId)) {
        throw new PaytrAdapterError("invalid_request");
    }
    const credentials = parseCredentials(input.credentials);
    const token = hmacBase64(
        `${credentials.merchantId}${input.merchantOrderId}${credentials.merchantSalt}`,
        credentials.merchantKey
    );
    return new URLSearchParams({
        merchant_id: credentials.merchantId,
        merchant_oid: input.merchantOrderId,
        paytr_token: token,
    });
}

function parseProviderMoney(value: unknown): number {
    const normalized = typeof value === "number" ? value.toString() : value;
    if (typeof normalized !== "string" || !/^\d{1,10}([.,]\d{1,2})?$/.test(normalized)) {
        throw new PaytrAdapterError("invalid_provider_response");
    }
    const [whole, fraction = ""] = normalized.replace(",", ".").split(".");
    const minor = (Number(whole) * 100) + Number(fraction.padEnd(2, "0"));
    if (!Number.isSafeInteger(minor) || minor > 2_147_483_647) {
        throw new PaytrAdapterError("invalid_provider_response");
    }
    return minor;
}

const paytrStatusResponseSchema = z.discriminatedUnion("status", [
    z.object({
        status: z.literal("success"),
        payment_amount: z.union([z.string(), z.number()]),
        payment_total: z.union([z.string(), z.number()]),
        currency: z.string().trim().min(2).max(3),
        test_mode: z.union([z.string(), z.number(), z.boolean()]),
        returns: z.array(z.unknown()).max(100).optional().default([]),
    }),
    z.object({
        status: z.literal("error"),
        err_no: z.union([z.string(), z.number()]).optional(),
        err_msg: z.string().max(1000).optional(),
    }),
]);

export type PaytrStatusQueryResult =
    | {
        status: "success";
        paymentAmountMinor: number;
        paymentTotalMinor: number;
        currency: string;
        testMode: boolean;
        returnCount: number;
        refunds?: Array<{
            referenceNo: string;
            amountMinor: number;
            completed: boolean;
        }>;
    }
    | { status: "error"; errorCode: string };

export async function queryPaytrPaymentStatus(input: {
    merchantOrderId: string;
    credentials: PaytrCredentials;
    fetchImpl?: typeof fetch;
    timeoutMs?: number;
}): Promise<PaytrStatusQueryResult> {
    const form = buildPaytrStatusQueryForm(input);
    const timeoutMs = Math.max(1_000, Math.min(input.timeoutMs ?? DEFAULT_TIMEOUT_MS, 30_000));
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), timeoutMs);
    try {
        const response = await (input.fetchImpl ?? fetch)(PAYTR_STATUS_QUERY_ENDPOINT, {
            method: "POST",
            headers: { "content-type": "application/x-www-form-urlencoded" },
            body: form.toString(),
            signal: controller.signal,
        });
        if (!response.ok) throw new PaytrAdapterError("provider_unavailable");
        const declaredLength = Number(response.headers.get("content-length") ?? "0");
        if (declaredLength > 16_384) throw new PaytrAdapterError("invalid_provider_response");
        const body = await response.text();
        if (Buffer.byteLength(body, "utf8") > 16_384) {
            throw new PaytrAdapterError("invalid_provider_response");
        }
        let json: unknown;
        try {
            json = JSON.parse(body);
        } catch {
            throw new PaytrAdapterError("invalid_provider_response");
        }
        const parsed = paytrStatusResponseSchema.safeParse(json);
        if (!parsed.success) throw new PaytrAdapterError("invalid_provider_response");
        if (parsed.data.status === "error") {
            return {
                status: "error",
                errorCode: String(parsed.data.err_no ?? "provider_error").slice(0, 80),
            };
        }
        const currency = parsed.data.currency.toUpperCase() === "TL"
            ? "TRY"
            : parsed.data.currency.toUpperCase();
        const refunds = parsed.data.returns.flatMap((entry) => {
            const refund = z.object({
                return_amount: z.union([z.string(), z.number()]),
                reference_no: z.string().trim().regex(/^[A-Za-z0-9]{1,64}$/),
                date_completed: z.union([z.string(), z.number()]).optional(),
            }).safeParse(entry);
            if (!refund.success) return [];
            try {
                return [{
                    referenceNo: refund.data.reference_no,
                    amountMinor: parseProviderMoney(refund.data.return_amount),
                    completed: refund.data.date_completed !== undefined
                        && String(refund.data.date_completed).trim().length > 0,
                }];
            } catch {
                return [];
            }
        });
        return {
            status: "success",
            paymentAmountMinor: parseProviderMoney(parsed.data.payment_amount),
            paymentTotalMinor: parseProviderMoney(parsed.data.payment_total),
            currency,
            testMode: parsed.data.test_mode === true
                || parsed.data.test_mode === 1
                || parsed.data.test_mode === "1",
            returnCount: parsed.data.returns.length,
            refunds,
        };
    } catch (error) {
        if (error instanceof PaytrAdapterError) throw error;
        if (controller.signal.aborted) throw new PaytrAdapterError("provider_timeout");
        throw new PaytrAdapterError("provider_unavailable");
    } finally {
        clearTimeout(timeout);
    }
}

export function buildPaytrIframeForm(
    request: PaytrIframeRequest,
    credentialsInput: PaytrCredentials
): URLSearchParams {
    const parsed = paytrIframeRequestSchema.safeParse(request);
    if (!parsed.success) throw new PaytrAdapterError("invalid_request");
    const credentials = parseCredentials(credentialsInput);
    const input = parsed.data;
    const userBasket = buildBasket(input.basket);
    const currency = asPaytrCurrency(input.currency);
    const noInstallment = input.noInstallment ? "1" : "0";
    const testMode = input.testMode ? "1" : "0";
    const paymentAmount = input.amountMinor.toString();
    const hashInput = [
        credentials.merchantId,
        input.userIp,
        input.merchantOrderId,
        input.email,
        paymentAmount,
        userBasket,
        noInstallment,
        input.maxInstallment.toString(),
        currency,
        testMode,
    ].join("");
    const token = hmacBase64(`${hashInput}${credentials.merchantSalt}`, credentials.merchantKey);

    return new URLSearchParams({
        merchant_id: credentials.merchantId,
        user_ip: input.userIp,
        merchant_oid: input.merchantOrderId,
        email: input.email,
        payment_amount: paymentAmount,
        paytr_token: token,
        user_basket: userBasket,
        debug_on: "0",
        no_installment: noInstallment,
        max_installment: input.maxInstallment.toString(),
        user_name: input.fullName,
        user_address: input.address,
        user_phone: input.phone,
        merchant_ok_url: input.successUrl,
        merchant_fail_url: input.failureUrl,
        timeout_limit: "30",
        currency,
        test_mode: testMode,
        lang: input.language,
    });
}

const tokenResponseSchema = z.discriminatedUnion("status", [
    z.object({ status: z.literal("success"), token: z.string().trim().min(1).max(4096) }),
    z.object({ status: z.literal("failed"), reason: z.string().max(1000).optional() }),
]);

export async function requestPaytrIframeToken(input: {
    request: PaytrIframeRequest;
    credentials: PaytrCredentials;
    fetchImpl?: typeof fetch;
    timeoutMs?: number;
}): Promise<{ token: string; iframeUrl: string }> {
    const form = buildPaytrIframeForm(input.request, input.credentials);
    const timeoutMs = Math.max(1_000, Math.min(input.timeoutMs ?? DEFAULT_TIMEOUT_MS, 30_000));
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), timeoutMs);

    try {
        const response = await (input.fetchImpl ?? fetch)(PAYTR_IFRAME_TOKEN_ENDPOINT, {
            method: "POST",
            headers: { "content-type": "application/x-www-form-urlencoded" },
            body: form.toString(),
            signal: controller.signal,
        });
        if (!response.ok) throw new PaytrAdapterError("provider_unavailable");
        const declaredLength = Number(response.headers.get("content-length") ?? "0");
        if (declaredLength > 16_384) throw new PaytrAdapterError("invalid_provider_response");
        const body = await response.text();
        if (Buffer.byteLength(body, "utf8") > 16_384) {
            throw new PaytrAdapterError("invalid_provider_response");
        }
        let json: unknown;
        try {
            json = JSON.parse(body);
        } catch {
            throw new PaytrAdapterError("invalid_provider_response");
        }
        const parsed = tokenResponseSchema.safeParse(json);
        if (!parsed.success) throw new PaytrAdapterError("invalid_provider_response");
        if (parsed.data.status === "failed") throw new PaytrAdapterError("provider_rejected");
        return {
            token: parsed.data.token,
            iframeUrl: `${PAYTR_IFRAME_URL_PREFIX}${encodeURIComponent(parsed.data.token)}`,
        };
    } catch (error) {
        if (error instanceof PaytrAdapterError) throw error;
        if (controller.signal.aborted) throw new PaytrAdapterError("provider_timeout");
        throw new PaytrAdapterError("provider_unavailable");
    } finally {
        clearTimeout(timeout);
    }
}

function getSingleField(form: URLSearchParams, key: string, maxLength: number): string {
    const values = form.getAll(key);
    if (values.length !== 1 || values[0].length < 1 || values[0].length > maxLength) {
        throw new PaymentWebhookError("invalid_event");
    }
    return values[0];
}

function safeBase64Equal(submitted: string, expected: string): boolean {
    if (!/^[A-Za-z0-9+/]+={0,2}$/.test(submitted)) return false;
    const submittedBuffer = Buffer.from(submitted, "base64");
    const expectedBuffer = Buffer.from(expected, "base64");
    if (submittedBuffer.toString("base64") !== submitted || submittedBuffer.length !== expectedBuffer.length) {
        return false;
    }
    return timingSafeEqual(submittedBuffer, expectedBuffer);
}

export function buildPaytrCallbackHash(input: {
    merchantOrderId: string;
    status: "success" | "failed";
    totalAmount: string;
    credentials: PaytrCredentials;
}): string {
    const credentials = parseCredentials(input.credentials);
    return hmacBase64(
        `${input.merchantOrderId}${credentials.merchantSalt}${input.status}${input.totalAmount}`,
        credentials.merchantKey
    );
}

function parsePaytrCallback(
    rawBody: Uint8Array,
    credentials: PaytrCredentials
): VerifiedPaymentWebhook {
    if (rawBody.byteLength === 0 || rawBody.byteLength > MAX_CALLBACK_BYTES) {
        throw new PaymentWebhookError("invalid_event");
    }
    let decoded: string;
    try {
        decoded = new TextDecoder("utf-8", { fatal: true }).decode(rawBody);
    } catch {
        throw new PaymentWebhookError("invalid_event");
    }
    const form = new URLSearchParams(decoded);
    const merchantOrderId = getSingleField(form, "merchant_oid", 64);
    if (!/^[A-Za-z0-9]{1,64}$/.test(merchantOrderId)) {
        throw new PaymentWebhookError("invalid_event");
    }
    const status = getSingleField(form, "status", 7);
    if (status !== "success" && status !== "failed") {
        throw new PaymentWebhookError("invalid_event");
    }
    const totalAmount = getSingleField(form, "total_amount", 10);
    if (!/^\d{1,10}$/.test(totalAmount)) throw new PaymentWebhookError("invalid_event");
    const amountMinor = Number(totalAmount);
    if (!Number.isSafeInteger(amountMinor) || amountMinor > 2_147_483_647) {
        throw new PaymentWebhookError("invalid_event");
    }
    const submittedHash = getSingleField(form, "hash", 128);
    const expectedHash = buildPaytrCallbackHash({
        merchantOrderId,
        status,
        totalAmount,
        credentials,
    });
    if (!safeBase64Equal(submittedHash, expectedHash)) {
        throw new PaymentWebhookError("invalid_signature");
    }

    const paymentType = form.get("payment_type")?.slice(0, 32);
    const testMode = form.get("test_mode") === "1";
    const failureReasonCode = status === "failed"
        ? form.get("failed_reason_code")?.slice(0, 32)
        : undefined;
    const callbackCurrency = form.get("currency");
    const currency = callbackCurrency === "TL"
        ? "TRY"
        : callbackCurrency && /^[A-Za-z]{3}$/.test(callbackCurrency)
            ? callbackCurrency.toUpperCase()
            : undefined;

    return {
        providerEventId: merchantOrderId,
        eventType: status === "success" ? "paytr.payment.success" : "paytr.payment.failed",
        outcome: status === "success" ? "payment_succeeded" : "payment_failed",
        signatureVersion: "hmac-sha256-v1",
        providerOrderReference: merchantOrderId,
        amountMinor,
        currency,
        metadata: {
            status,
            testMode,
            ...(paymentType ? { paymentType } : {}),
            ...(failureReasonCode ? { failureReasonCode } : {}),
        },
    };
}

export function createPaytrWebhookVerifier(
    credentialsInput: PaytrCredentials
): PaymentWebhookVerifier {
    const credentials = parseCredentials(credentialsInput);
    return {
        provider: "paytr",
        acknowledgement: {
            status: 200,
            contentType: "text/plain; charset=utf-8",
            body: "OK",
        },
        async verify({ rawBody }) {
            return parsePaytrCallback(rawBody, credentials);
        },
    };
}
