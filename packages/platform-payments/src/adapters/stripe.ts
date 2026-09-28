import { z } from "zod";

export const STRIPE_API_BASE_URL = "https://api.stripe.com";
export const STRIPE_CHECKOUT_SESSIONS_PATH = "/v1/checkout/sessions";
export const STRIPE_API_VERSION = "2026-02-25.clover";

const MAX_RESPONSE_BYTES = 64 * 1024;
const DEFAULT_TIMEOUT_MS = 10_000;
const currencySchema = z.enum(["TRY", "USD", "EUR", "GBP"]);
const checkoutInputSchema = z.object({
    orderId: z.string().uuid(),
    amountMinor: z.number().int().positive().max(2_147_483_647),
    currency: currencySchema,
    productName: z.string().trim().min(1).max(160),
    successUrl: z.string().url().refine(isHttpsUrl),
    cancelUrl: z.string().url().refine(isHttpsUrl),
    idempotencyKey: z.string().min(16).max(255).regex(/^[A-Za-z0-9:_-]+$/),
});
const providerErrorSchema = z.object({
    error: z.object({
        type: z.string().max(100).optional(),
        code: z.string().max(100).optional(),
    }),
});
const providerSessionSchema = z.object({
    id: z.string().regex(/^cs_test_[A-Za-z0-9_]+$/).max(255),
    object: z.literal("checkout.session"),
    url: z.string().url(),
    livemode: z.literal(false),
    client_reference_id: z.string().uuid(),
    amount_total: z.number().int().positive(),
    currency: z.string().regex(/^[a-z]{3}$/),
    payment_status: z.enum(["unpaid", "no_payment_required"]),
    status: z.literal("open"),
});

export interface StripeTestCredentials {
    apiKey: string;
}

export class StripeAdapterError extends Error {
    constructor(public readonly code:
        | "invalid_request"
        | "provider_timeout"
        | "provider_unavailable"
        | "provider_rejected"
        | "invalid_provider_response"
    ) {
        super(code);
        this.name = "StripeAdapterError";
    }
}

function isHttpsUrl(value: string): boolean {
    try {
        const url = new URL(value);
        return url.protocol === "https:" && url.username === "" && url.password === "";
    } catch {
        return false;
    }
}

function isStripeHostedUrl(value: string): boolean {
    try {
        const url = new URL(value);
        return url.protocol === "https:"
            && url.username === ""
            && url.password === ""
            && (url.port === "" || url.port === "443")
            && url.hostname === "checkout.stripe.com";
    } catch {
        return false;
    }
}

function assertCredentials(credentials: StripeTestCredentials): void {
    if (
        !/^(?:sk|rk)_test_[A-Za-z0-9_]+$/.test(credentials.apiKey)
        || credentials.apiKey.length > 512
    ) throw new StripeAdapterError("invalid_request");
}

async function readBoundedResponse(response: Response): Promise<string> {
    if (!response.body) throw new StripeAdapterError("invalid_provider_response");
    const declaredLength = Number(response.headers.get("content-length") ?? "0");
    if (declaredLength > MAX_RESPONSE_BYTES) throw new StripeAdapterError("invalid_provider_response");

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
                throw new StripeAdapterError("invalid_provider_response");
            }
            chunks.push(value);
        }
    } finally {
        reader.releaseLock();
    }
    return Buffer.concat(chunks, totalBytes).toString("utf8");
}

function createRequestBody(input: z.infer<typeof checkoutInputSchema>): URLSearchParams {
    return new URLSearchParams({
        mode: "payment",
        locale: "tr",
        success_url: input.successUrl,
        cancel_url: input.cancelUrl,
        client_reference_id: input.orderId,
        "metadata[order_id]": input.orderId,
        "payment_intent_data[metadata][order_id]": input.orderId,
        "line_items[0][quantity]": "1",
        "line_items[0][price_data][currency]": input.currency.toLowerCase(),
        "line_items[0][price_data][unit_amount]": String(input.amountMinor),
        "line_items[0][price_data][product_data][name]": input.productName,
    });
}

export async function requestStripeCheckoutSession(input: z.input<typeof checkoutInputSchema> & {
    credentials: StripeTestCredentials;
    fetchImpl?: typeof fetch;
    timeoutMs?: number;
}): Promise<{
    orderId: string;
    sessionId: string;
    checkoutUrl: string;
    amountMinor: number;
    currency: z.infer<typeof currencySchema>;
}> {
    const parsed = checkoutInputSchema.safeParse(input);
    if (!parsed.success) throw new StripeAdapterError("invalid_request");
    assertCredentials(input.credentials);

    const controller = new AbortController();
    const timeoutMs = Math.max(1_000, Math.min(input.timeoutMs ?? DEFAULT_TIMEOUT_MS, 30_000));
    const timeout = setTimeout(() => controller.abort(), timeoutMs);
    try {
        const response = await (input.fetchImpl ?? fetch)(
            `${STRIPE_API_BASE_URL}${STRIPE_CHECKOUT_SESSIONS_PATH}`,
            {
                method: "POST",
                headers: {
                    authorization: `Bearer ${input.credentials.apiKey}`,
                    "content-type": "application/x-www-form-urlencoded",
                    "idempotency-key": parsed.data.idempotencyKey,
                    "stripe-version": STRIPE_API_VERSION,
                },
                body: createRequestBody(parsed.data),
                signal: controller.signal,
            }
        );
        const responseBody = await readBoundedResponse(response);
        let raw: unknown;
        try {
            raw = JSON.parse(responseBody);
        } catch {
            throw new StripeAdapterError("invalid_provider_response");
        }
        if (!response.ok) {
            if (providerErrorSchema.safeParse(raw).success) {
                throw new StripeAdapterError("provider_rejected");
            }
            throw new StripeAdapterError("provider_unavailable");
        }
        const session = providerSessionSchema.safeParse(raw);
        if (!session.success) throw new StripeAdapterError("invalid_provider_response");
        if (
            session.data.client_reference_id !== parsed.data.orderId
            || session.data.amount_total !== parsed.data.amountMinor
            || session.data.currency !== parsed.data.currency.toLowerCase()
            || !isStripeHostedUrl(session.data.url)
        ) throw new StripeAdapterError("invalid_provider_response");

        return {
            orderId: parsed.data.orderId,
            sessionId: session.data.id,
            checkoutUrl: session.data.url,
            amountMinor: session.data.amount_total,
            currency: parsed.data.currency,
        };
    } catch (error) {
        if (error instanceof StripeAdapterError) throw error;
        if (error instanceof Error && error.name === "AbortError") {
            throw new StripeAdapterError("provider_timeout");
        }
        throw new StripeAdapterError("provider_unavailable");
    } finally {
        clearTimeout(timeout);
    }
}
