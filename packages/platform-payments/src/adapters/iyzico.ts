import { createHmac, randomBytes, timingSafeEqual } from "node:crypto";
import { z } from "zod";

export const IYZICO_SANDBOX_BASE_URL = "https://sandbox-api.iyzipay.com";
export const IYZICO_CF_INITIALIZE_PATH = "/payment/iyzipos/checkoutform/initialize/auth/ecom";
export const IYZICO_CF_RETRIEVE_PATH = "/payment/iyzipos/checkoutform/auth/ecom/detail";

const MAX_RESPONSE_BYTES = 64 * 1024;
const DEFAULT_TIMEOUT_MS = 10_000;
const currencySchema = z.enum(["TRY", "USD", "EUR", "GBP", "NOK", "CHF"]);
const safeText = (min: number, max: number) => z.string().trim().min(min).max(max);
const tokenSchema = safeText(1, 512).regex(/^[A-Za-z0-9._~+/=-]+$/);
const signatureSchema = z.string().regex(/^[a-fA-F0-9]{64}$/);
const addressSchema = z.object({
    address: safeText(5, 400),
    contactName: safeText(2, 100),
    city: safeText(2, 80),
    country: safeText(2, 80),
    zipCode: safeText(1, 20).optional(),
});
const buyerSchema = z.object({
    id: safeText(1, 64).regex(/^[A-Za-z0-9._:-]+$/),
    name: safeText(1, 60),
    surname: safeText(1, 60),
    identityNumber: z.string().regex(/^\d{11}$/),
    email: z.string().trim().email().max(100),
    gsmNumber: z.string().trim().regex(/^\+\d{7,15}$/),
    registrationAddress: safeText(5, 400),
    city: safeText(2, 80),
    country: safeText(2, 80),
    zipCode: safeText(1, 20).optional(),
    ip: z.string().trim().min(3).max(64),
});
const initializeSchema = z.object({
    conversationId: z.string().uuid(),
    amountMinor: z.number().int().positive().max(2_147_483_647),
    currency: currencySchema,
    callbackUrl: z.string().url().refine((value) => new URL(value).protocol === "https:"),
    buyer: buyerSchema,
    billingAddress: addressSchema,
    shippingAddress: addressSchema,
    basketItem: z.object({
        id: safeText(1, 64).regex(/^[A-Za-z0-9._:-]+$/),
        name: safeText(1, 160),
        category: safeText(1, 80),
    }),
});
const retrieveSchema = z.object({
    conversationId: z.string().uuid(),
    token: tokenSchema,
});
const providerBaseSchema = z.object({
    status: z.enum(["success", "failure"]),
    conversationId: z.string().max(128).optional(),
    errorCode: z.union([z.string(), z.number()]).optional(),
    errorMessage: z.string().max(2_000).optional(),
});

export interface IyzicoCredentials {
    apiKey: string;
    secretKey: string;
}

export class IyzicoAdapterError extends Error {
    constructor(public readonly code:
        | "invalid_request"
        | "provider_timeout"
        | "provider_unavailable"
        | "provider_rejected"
        | "invalid_provider_response"
    ) {
        super(code);
        this.name = "IyzicoAdapterError";
    }
}

function assertCredentials(credentials: IyzicoCredentials): void {
    if (
        !credentials.apiKey.startsWith("sandbox-")
        || !credentials.secretKey.startsWith("sandbox-")
        || credentials.apiKey.length > 512
        || credentials.secretKey.length > 512
    ) throw new IyzicoAdapterError("invalid_request");
}

function minorToDecimal(amountMinor: number): string {
    if (!Number.isSafeInteger(amountMinor) || amountMinor <= 0) {
        throw new IyzicoAdapterError("invalid_request");
    }
    return `${Math.floor(amountMinor / 100)}.${String(amountMinor % 100).padStart(2, "0")}`;
}

function normalizeSignatureDecimal(value: string | number): string {
    const normalized = String(value).trim();
    if (!/^\d+(?:\.\d+)?$/.test(normalized)) {
        throw new IyzicoAdapterError("invalid_provider_response");
    }
    if (!normalized.includes(".")) return normalized;
    return normalized.replace(/0+$/, "").replace(/\.$/, "");
}

function buildResponseSignature(secretKey: string, values: readonly string[]): string {
    if (!secretKey.startsWith("sandbox-") || secretKey.length > 512) {
        throw new IyzicoAdapterError("invalid_request");
    }
    return createHmac("sha256", secretKey).update(values.join(":"), "utf8").digest("hex");
}

function signatureMatches(submitted: string, expected: string): boolean {
    const parsed = signatureSchema.safeParse(submitted);
    if (!parsed.success) return false;
    const submittedBytes = Buffer.from(parsed.data.toLowerCase(), "hex");
    const expectedBytes = Buffer.from(expected, "hex");
    return submittedBytes.length === expectedBytes.length
        && timingSafeEqual(submittedBytes, expectedBytes);
}

export function buildIyzicoCfInitializeResponseSignature(input: {
    secretKey: string;
    conversationId: string;
    token: string;
}): string {
    return buildResponseSignature(input.secretKey, [input.conversationId, input.token]);
}

export function buildIyzicoCfRetrieveResponseSignature(input: {
    secretKey: string;
    paymentStatus: string;
    paymentId: string;
    currency: string;
    basketId: string;
    conversationId: string;
    paidPrice: string | number;
    price: string | number;
    token: string;
}): string {
    return buildResponseSignature(input.secretKey, [
        input.paymentStatus,
        input.paymentId,
        input.currency,
        input.basketId,
        input.conversationId,
        normalizeSignatureDecimal(input.paidPrice),
        normalizeSignatureDecimal(input.price),
        input.token,
    ]);
}

export function buildIyzicoV2Authorization(input: {
    apiKey: string;
    secretKey: string;
    randomKey: string;
    uriPath: string;
    requestBody: string;
}): string {
    if (!/^\/[A-Za-z0-9/_-]+$/.test(input.uriPath) || !/^[A-Za-z0-9]{16,80}$/.test(input.randomKey)) {
        throw new IyzicoAdapterError("invalid_request");
    }
    const signature = createHmac("sha256", input.secretKey)
        .update(`${input.randomKey}${input.uriPath}${input.requestBody}`, "utf8")
        .digest("hex");
    const authorization = Buffer.from(
        `apiKey:${input.apiKey}&randomKey:${input.randomKey}&signature:${signature}`,
        "utf8"
    ).toString("base64");
    return `IYZWSv2 ${authorization}`;
}

export function isAllowedIyzicoHostedUrl(value: string): boolean {
    try {
        const url = new URL(value);
        return url.protocol === "https:"
            && url.username === ""
            && url.password === ""
            && (url.port === "" || url.port === "443")
            && (url.hostname === "iyzipay.com" || url.hostname.endsWith(".iyzipay.com"));
    } catch {
        return false;
    }
}

function safeEqual(left: string, right: string): boolean {
    const leftBuffer = Buffer.from(left, "utf8");
    const rightBuffer = Buffer.from(right, "utf8");
    return leftBuffer.length === rightBuffer.length && timingSafeEqual(leftBuffer, rightBuffer);
}

async function readBoundedResponse(response: Response): Promise<string> {
    if (!response.body) throw new IyzicoAdapterError("invalid_provider_response");
    const reader = response.body.getReader();
    const chunks: Uint8Array[] = [];
    let totalBytes = 0;
    try {
        while (true) {
            const { done, value } = await reader.read();
            if (done) break;
            totalBytes += value.byteLength;
            if (totalBytes > MAX_RESPONSE_BYTES) {
                await reader.cancel();
                throw new IyzicoAdapterError("invalid_provider_response");
            }
            chunks.push(value);
        }
    } finally {
        reader.releaseLock();
    }
    return Buffer.concat(chunks, totalBytes).toString("utf8");
}

async function postIyzico(input: {
    path: typeof IYZICO_CF_INITIALIZE_PATH | typeof IYZICO_CF_RETRIEVE_PATH;
    body: Record<string, unknown>;
    credentials: IyzicoCredentials;
    fetchImpl?: typeof fetch;
    timeoutMs?: number;
    randomKey?: string;
}): Promise<unknown> {
    assertCredentials(input.credentials);
    const requestBody = JSON.stringify(input.body);
    const randomKey = input.randomKey ?? randomBytes(24).toString("hex");
    const controller = new AbortController();
    const timeoutMs = Math.max(1_000, Math.min(input.timeoutMs ?? DEFAULT_TIMEOUT_MS, 30_000));
    const timeout = setTimeout(() => controller.abort(), timeoutMs);
    try {
        const response = await (input.fetchImpl ?? fetch)(`${IYZICO_SANDBOX_BASE_URL}${input.path}`, {
            method: "POST",
            headers: {
                authorization: buildIyzicoV2Authorization({
                    apiKey: input.credentials.apiKey,
                    secretKey: input.credentials.secretKey,
                    randomKey,
                    uriPath: input.path,
                    requestBody,
                }),
                "content-type": "application/json",
                "x-iyzi-rnd": randomKey,
            },
            body: requestBody,
            signal: controller.signal,
        });
        if (!response.ok) throw new IyzicoAdapterError("provider_unavailable");
        const declaredLength = Number(response.headers.get("content-length") ?? "0");
        if (declaredLength > MAX_RESPONSE_BYTES) throw new IyzicoAdapterError("invalid_provider_response");
        const responseBody = await readBoundedResponse(response);
        try {
            return JSON.parse(responseBody);
        } catch {
            throw new IyzicoAdapterError("invalid_provider_response");
        }
    } catch (error) {
        if (error instanceof IyzicoAdapterError) throw error;
        if (error instanceof Error && error.name === "AbortError") {
            throw new IyzicoAdapterError("provider_timeout");
        }
        throw new IyzicoAdapterError("provider_unavailable");
    } finally {
        clearTimeout(timeout);
    }
}

export async function requestIyzicoCheckoutForm(input: z.input<typeof initializeSchema> & {
    credentials: IyzicoCredentials;
    fetchImpl?: typeof fetch;
    timeoutMs?: number;
    randomKey?: string;
}): Promise<{ conversationId: string; token: string; paymentPageUrl: string }> {
    const parsed = initializeSchema.safeParse(input);
    if (!parsed.success) throw new IyzicoAdapterError("invalid_request");
    const amount = minorToDecimal(parsed.data.amountMinor);
    const body = {
        locale: "tr",
        conversationId: parsed.data.conversationId,
        price: amount,
        paidPrice: amount,
        currency: parsed.data.currency,
        basketId: parsed.data.conversationId,
        paymentGroup: "PRODUCT",
        callbackUrl: parsed.data.callbackUrl,
        enabledInstallments: [1],
        buyer: parsed.data.buyer,
        shippingAddress: parsed.data.shippingAddress,
        billingAddress: parsed.data.billingAddress,
        basketItems: [{
            id: parsed.data.basketItem.id,
            price: amount,
            name: parsed.data.basketItem.name,
            category1: parsed.data.basketItem.category,
            itemType: "VIRTUAL",
        }],
    };
    const raw = await postIyzico({
        path: IYZICO_CF_INITIALIZE_PATH,
        body,
        credentials: input.credentials,
        fetchImpl: input.fetchImpl,
        timeoutMs: input.timeoutMs,
        randomKey: input.randomKey,
    });
    const base = providerBaseSchema.safeParse(raw);
    if (!base.success) throw new IyzicoAdapterError("invalid_provider_response");
    if (base.data.status !== "success") throw new IyzicoAdapterError("provider_rejected");
    const response = providerBaseSchema.extend({
        token: tokenSchema,
        paymentPageUrl: z.string().url(),
        signature: signatureSchema,
    }).safeParse(raw);
    if (!response.success) throw new IyzicoAdapterError("invalid_provider_response");
    if (
        response.data.conversationId !== parsed.data.conversationId
        || !isAllowedIyzicoHostedUrl(response.data.paymentPageUrl)
        || !signatureMatches(response.data.signature, buildIyzicoCfInitializeResponseSignature({
            secretKey: input.credentials.secretKey,
            conversationId: parsed.data.conversationId,
            token: response.data.token,
        }))
    ) throw new IyzicoAdapterError("invalid_provider_response");
    return {
        conversationId: parsed.data.conversationId,
        token: response.data.token,
        paymentPageUrl: response.data.paymentPageUrl,
    };
}

export async function retrieveIyzicoCheckoutForm(input: z.input<typeof retrieveSchema> & {
    credentials: IyzicoCredentials;
    fetchImpl?: typeof fetch;
    timeoutMs?: number;
    randomKey?: string;
}): Promise<{
    conversationId: string;
    token: string;
    paymentId: string;
    amountMinor: number;
    paidAmountMinor: number;
    currency: z.infer<typeof currencySchema>;
    fraudStatus: number;
    paymentStatus: string;
}> {
    const parsed = retrieveSchema.safeParse(input);
    if (!parsed.success) throw new IyzicoAdapterError("invalid_request");
    const raw = await postIyzico({
        path: IYZICO_CF_RETRIEVE_PATH,
        body: { locale: "tr", conversationId: parsed.data.conversationId, token: parsed.data.token },
        credentials: input.credentials,
        fetchImpl: input.fetchImpl,
        timeoutMs: input.timeoutMs,
        randomKey: input.randomKey,
    });
    const base = providerBaseSchema.safeParse(raw);
    if (!base.success) throw new IyzicoAdapterError("invalid_provider_response");
    if (base.data.status !== "success") throw new IyzicoAdapterError("provider_rejected");
    const response = providerBaseSchema.extend({
        token: safeText(1, 512),
        paymentId: z.union([z.string(), z.number()]).transform(String),
        basketId: safeText(1, 191),
        price: z.union([z.string(), z.number()]),
        paidPrice: z.union([z.string(), z.number()]),
        currency: currencySchema,
        fraudStatus: z.number().int(),
        paymentStatus: safeText(1, 80),
        signature: signatureSchema,
    }).safeParse(raw);
    if (!response.success) throw new IyzicoAdapterError("invalid_provider_response");
    if (
        response.data.conversationId !== parsed.data.conversationId
        || !safeEqual(response.data.token, parsed.data.token)
        || response.data.basketId !== parsed.data.conversationId
        || !signatureMatches(response.data.signature, buildIyzicoCfRetrieveResponseSignature({
            secretKey: input.credentials.secretKey,
            paymentStatus: response.data.paymentStatus,
            paymentId: response.data.paymentId,
            currency: response.data.currency,
            basketId: response.data.basketId,
            conversationId: parsed.data.conversationId,
            paidPrice: response.data.paidPrice,
            price: response.data.price,
            token: response.data.token,
        }))
    ) throw new IyzicoAdapterError("invalid_provider_response");
    return {
        conversationId: parsed.data.conversationId,
        token: parsed.data.token,
        paymentId: response.data.paymentId,
        amountMinor: parseDecimalToMinor(response.data.price),
        paidAmountMinor: parseDecimalToMinor(response.data.paidPrice),
        currency: response.data.currency,
        fraudStatus: response.data.fraudStatus,
        paymentStatus: response.data.paymentStatus,
    };
}

function parseDecimalToMinor(value: string | number): number {
    const normalized = String(value).trim();
    if (!/^\d+(?:\.\d{1,2})?$/.test(normalized)) {
        throw new IyzicoAdapterError("invalid_provider_response");
    }
    const [whole, fraction = ""] = normalized.split(".");
    const minor = Number(whole) * 100 + Number(fraction.padEnd(2, "0"));
    if (!Number.isSafeInteger(minor) || minor <= 0) {
        throw new IyzicoAdapterError("invalid_provider_response");
    }
    return minor;
}
