import { z } from "zod";

export const SHOPIER_API_BASE_URL = "https://api.shopier.com/v1";
export const SHOPIER_PRODUCTS_PATH = "/products";
export const SHOPIER_ORDERS_PATH = "/orders";
export const SHOPIER_REFUNDS_PATH = "/refunds";

const DEFAULT_TIMEOUT_MS = 10_000;
const MAX_RESPONSE_BYTES = 64 * 1024;
const currencySchema = z.enum(["TRY", "USD", "EUR"]);
const moneySchema = z.string().regex(/^(?:0|[1-9]\d{0,9})(?:\.\d{1,2})?$/);
const createListingSchema = z.object({
    orderId: z.string().uuid(),
    amountMinor: z.number().int().positive().max(2_147_483_647),
    currency: currencySchema,
    productName: z.string().trim().min(1).max(120),
    mediaUrl: z.string().url().refine(isAllowedMediaUrl),
});
const productSchema = z.object({
    id: z.string().regex(/^\d{1,64}$/),
    title: z.string().min(1).max(240),
    type: z.literal("digital"),
    url: z.string().url(),
    priceData: z.object({
        currency: currencySchema,
        price: z.string(),
    }),
    stockStatus: z.enum(["inStock", "outOfStock"]).optional(),
    stockQuantity: z.number().int().min(0).optional(),
    shippingPayer: z.literal("sellerPays"),
    customListing: z.literal(true),
}).passthrough();
const paidOrderSchema = z.object({
    id: z.string().trim().min(1).max(191),
    paymentStatus: z.literal("paid"),
    dateCreated: z.string().trim().min(1).max(64),
    currency: currencySchema,
    totals: z.object({
        subtotal: moneySchema,
        shipping: moneySchema,
        discount: moneySchema,
        total: moneySchema,
    }),
    shippingInfo: z.object({ email: z.string().trim().email().max(191) }).passthrough(),
    lineItems: z.array(z.object({
        productId: z.string().regex(/^\d{1,64}$/),
        title: z.string().trim().min(1).max(240),
        type: z.literal("digital"),
        quantity: z.literal(1),
        price: moneySchema,
        total: moneySchema,
    }).passthrough()).length(1),
    refunds: z.array(z.object({
        status: z.enum(["pending", "failed", "succeeded"]),
    }).passthrough()).optional().default([]),
}).passthrough();
const refundSchema = z.object({
    id: z.string().trim().regex(/^[A-Za-z0-9._:-]{1,191}$/),
    type: z.enum(["full", "partial"]),
    status: z.enum(["pending", "failed", "succeeded"]),
    orderId: z.string().trim().regex(/^[A-Za-z0-9._:-]{1,191}$/),
    dateCreated: z.string().trim().min(1).max(64),
    dateRefunded: z.string().trim().min(1).max(64).optional(),
    currency: currencySchema,
    total: moneySchema,
    note: z.string().max(1000).optional(),
}).passthrough();
const createRefundSchema = z.object({
    orderId: z.string().trim().regex(/^[A-Za-z0-9._:-]{1,191}$/),
    amountMinor: z.number().int().positive().max(2_147_483_647),
    currency: currencySchema,
    note: z.string().trim().min(3).max(500),
});

export interface ShopierCredentials {
    personalAccessToken: string;
}

export class ShopierAdapterError extends Error {
    constructor(public readonly code:
        | "invalid_request"
        | "provider_timeout"
        | "provider_unavailable"
        | "provider_rate_limited"
        | "provider_rejected"
        | "invalid_provider_response"
    ) {
        super(code);
        this.name = "ShopierAdapterError";
    }
}

function isAllowedMediaUrl(value: string): boolean {
    try {
        const url = new URL(value);
        return url.protocol === "https:"
            && url.username === ""
            && url.password === ""
            && (url.port === "" || url.port === "443")
            && /\.(?:jpe?g|png|bmp)$/i.test(url.pathname);
    } catch {
        return false;
    }
}

export function isAllowedShopierHostedUrl(value: string, productId?: string): boolean {
    try {
        const url = new URL(value);
        const expectedPath = productId ? `/${productId}` : null;
        return url.protocol === "https:"
            && url.username === ""
            && url.password === ""
            && url.port === ""
            && url.hostname === "www.shopier.com"
            && /^\/\d{1,64}$/.test(url.pathname)
            && (!expectedPath || url.pathname === expectedPath)
            && url.search === ""
            && url.hash === "";
    } catch {
        return false;
    }
}

function assertCredentials(credentials: ShopierCredentials): void {
    const token = credentials.personalAccessToken;
    if (
        token.length < 20
        || token.length > 2_048
        || !/^[\x21-\x7e]+$/.test(token)
    ) throw new ShopierAdapterError("invalid_request");
}

export function formatShopierMinorUnits(amountMinor: number): string {
    return `${Math.floor(amountMinor / 100)}.${String(amountMinor % 100).padStart(2, "0")}`;
}

export function parseShopierMinorUnits(value: string): number | null {
    const match = /^(0|[1-9]\d{0,9})(?:\.(\d{1,2}))?$/.exec(value);
    if (!match) return null;
    const amount = Number(match[1]) * 100 + Number((match[2] ?? "").padEnd(2, "0"));
    return Number.isSafeInteger(amount) && amount <= 2_147_483_647 ? amount : null;
}

function formatShopierDate(value: Date): string {
    if (!Number.isFinite(value.getTime())) throw new ShopierAdapterError("invalid_request");
    return value.toISOString().replace(/\.\d{3}Z$/, "+0000");
}

async function shopierRequest(input: {
    path: string;
    method: "GET" | "POST";
    query?: URLSearchParams;
    body?: string;
    credentials: ShopierCredentials;
    fetchImpl?: typeof fetch;
    timeoutMs?: number;
}): Promise<unknown> {
    assertCredentials(input.credentials);
    const controller = new AbortController();
    const timeoutMs = Math.max(1_000, Math.min(input.timeoutMs ?? DEFAULT_TIMEOUT_MS, 30_000));
    const timeout = setTimeout(() => controller.abort(), timeoutMs);
    try {
        const response = await (input.fetchImpl ?? fetch)(
            `${SHOPIER_API_BASE_URL}${input.path}${input.query ? `?${input.query.toString()}` : ""}`,
            {
                method: input.method,
                redirect: "error",
                headers: {
                    accept: "application/json",
                    authorization: `Bearer ${input.credentials.personalAccessToken}`,
                    ...(input.body ? { "content-type": "application/json" } : {}),
                },
                body: input.body,
                signal: controller.signal,
            }
        );
        const responseText = await readBoundedResponse(response);
        let raw: unknown;
        try {
            raw = JSON.parse(responseText);
        } catch {
            throw new ShopierAdapterError("invalid_provider_response");
        }
        if (!response.ok) {
            if (response.status === 429) throw new ShopierAdapterError("provider_rate_limited");
            if (response.status >= 400 && response.status < 500) {
                throw new ShopierAdapterError("provider_rejected");
            }
            throw new ShopierAdapterError("provider_unavailable");
        }
        return raw;
    } catch (error) {
        if (error instanceof ShopierAdapterError) throw error;
        if (error instanceof Error && error.name === "AbortError") {
            throw new ShopierAdapterError("provider_timeout");
        }
        throw new ShopierAdapterError("provider_unavailable");
    } finally {
        clearTimeout(timeout);
    }
}

export type ShopierProduct = z.infer<typeof productSchema>;
export type ShopierPaidOrder = z.infer<typeof paidOrderSchema>;
export type ShopierRefund = z.infer<typeof refundSchema>;

export async function listShopierCustomListings(input: {
    dateStart: Date;
    dateEnd: Date;
    credentials: ShopierCredentials;
    fetchImpl?: typeof fetch;
    timeoutMs?: number;
}): Promise<ShopierProduct[]> {
    const query = new URLSearchParams({
        dateStart: formatShopierDate(input.dateStart),
        dateEnd: formatShopierDate(input.dateEnd),
        customListing: "true",
        limit: "50",
        page: "1",
        sort: "dateDesc",
    });
    const parsed = z.array(productSchema).max(50).safeParse(await shopierRequest({
        path: SHOPIER_PRODUCTS_PATH,
        method: "GET",
        query,
        credentials: input.credentials,
        fetchImpl: input.fetchImpl,
        timeoutMs: input.timeoutMs,
    }));
    if (!parsed.success) throw new ShopierAdapterError("invalid_provider_response");
    return parsed.data;
}

export async function listShopierPaidOrdersByProduct(input: {
    productId: string;
    credentials: ShopierCredentials;
    fetchImpl?: typeof fetch;
    timeoutMs?: number;
}): Promise<ShopierPaidOrder[]> {
    if (!/^\d{1,64}$/.test(input.productId)) throw new ShopierAdapterError("invalid_request");
    const query = new URLSearchParams({
        productId: input.productId,
        limit: "2",
        page: "1",
        sort: "dateDesc",
    });
    const parsed = z.array(paidOrderSchema).max(2).safeParse(await shopierRequest({
        path: SHOPIER_ORDERS_PATH,
        method: "GET",
        query,
        credentials: input.credentials,
        fetchImpl: input.fetchImpl,
        timeoutMs: input.timeoutMs,
    }));
    if (!parsed.success) throw new ShopierAdapterError("invalid_provider_response");
    return parsed.data;
}

export async function createShopierRefund(input: z.input<typeof createRefundSchema> & {
    credentials: ShopierCredentials;
    fetchImpl?: typeof fetch;
    timeoutMs?: number;
}): Promise<ShopierRefund> {
    const request = createRefundSchema.safeParse(input);
    if (!request.success) throw new ShopierAdapterError("invalid_request");
    const raw = await shopierRequest({
        path: SHOPIER_REFUNDS_PATH,
        method: "POST",
        body: JSON.stringify({
            orderId: request.data.orderId,
            amount: formatShopierMinorUnits(request.data.amountMinor),
            note: request.data.note,
        }),
        credentials: input.credentials,
        fetchImpl: input.fetchImpl,
        timeoutMs: input.timeoutMs,
    });
    const parsed = refundSchema.safeParse(raw);
    if (!parsed.success) throw new ShopierAdapterError("invalid_provider_response");
    const refund = parsed.data;
    if (
        refund.orderId !== request.data.orderId
        || refund.currency !== request.data.currency
        || parseShopierMinorUnits(refund.total) !== request.data.amountMinor
        || refund.type !== "full"
    ) throw new ShopierAdapterError("invalid_provider_response");
    return refund;
}

export async function getShopierRefund(input: {
    refundId: string;
    credentials: ShopierCredentials;
    fetchImpl?: typeof fetch;
    timeoutMs?: number;
}): Promise<ShopierRefund> {
    if (!/^[A-Za-z0-9._:-]{1,191}$/.test(input.refundId)) {
        throw new ShopierAdapterError("invalid_request");
    }
    const parsed = refundSchema.safeParse(await shopierRequest({
        path: `${SHOPIER_REFUNDS_PATH}/${input.refundId}`,
        method: "GET",
        credentials: input.credentials,
        fetchImpl: input.fetchImpl,
        timeoutMs: input.timeoutMs,
    }));
    if (!parsed.success || parsed.data.id !== input.refundId) {
        throw new ShopierAdapterError("invalid_provider_response");
    }
    return parsed.data;
}

export async function listShopierRefundsByOrder(input: {
    orderId: string;
    dateStart: Date;
    dateEnd: Date;
    credentials: ShopierCredentials;
    fetchImpl?: typeof fetch;
    timeoutMs?: number;
}): Promise<ShopierRefund[]> {
    if (!/^[A-Za-z0-9._:-]{1,191}$/.test(input.orderId)) {
        throw new ShopierAdapterError("invalid_request");
    }
    const query = new URLSearchParams({
        orderId: input.orderId,
        dateStart: formatShopierDate(input.dateStart),
        dateEnd: formatShopierDate(input.dateEnd),
        limit: "2",
        page: "1",
        sort: "dateDesc",
    });
    const parsed = z.array(refundSchema).max(2).safeParse(await shopierRequest({
        path: SHOPIER_REFUNDS_PATH,
        method: "GET",
        query,
        credentials: input.credentials,
        fetchImpl: input.fetchImpl,
        timeoutMs: input.timeoutMs,
    }));
    if (!parsed.success) throw new ShopierAdapterError("invalid_provider_response");
    return parsed.data;
}

async function readBoundedResponse(response: Response): Promise<string> {
    if (!response.body) throw new ShopierAdapterError("invalid_provider_response");
    const declaredLength = Number(response.headers.get("content-length") ?? "0");
    if (declaredLength > MAX_RESPONSE_BYTES) {
        throw new ShopierAdapterError("invalid_provider_response");
    }
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
                throw new ShopierAdapterError("invalid_provider_response");
            }
            chunks.push(value);
        }
    } finally {
        reader.releaseLock();
    }
    return Buffer.concat(chunks, totalBytes).toString("utf8");
}

export async function createShopierCustomListing(input: z.input<typeof createListingSchema> & {
    credentials: ShopierCredentials;
    fetchImpl?: typeof fetch;
    timeoutMs?: number;
}): Promise<{
    productId: string;
    checkoutUrl: string;
    amountMinor: number;
    currency: z.infer<typeof currencySchema>;
}> {
    const parsed = createListingSchema.safeParse(input);
    if (!parsed.success) throw new ShopierAdapterError("invalid_request");
    assertCredentials(input.credentials);
    const title = `${parsed.data.productName} [${parsed.data.orderId.slice(0, 8)}]`;
    const controller = new AbortController();
    const timeoutMs = Math.max(1_000, Math.min(input.timeoutMs ?? DEFAULT_TIMEOUT_MS, 30_000));
    const timeout = setTimeout(() => controller.abort(), timeoutMs);
    try {
        const response = await (input.fetchImpl ?? fetch)(
            `${SHOPIER_API_BASE_URL}${SHOPIER_PRODUCTS_PATH}`,
            {
                method: "POST",
                redirect: "error",
                headers: {
                    accept: "application/json",
                    authorization: `Bearer ${input.credentials.personalAccessToken}`,
                    "content-type": "application/json",
                },
                body: JSON.stringify({
                    title,
                    description: "Hushle hesabına tanımlanan tek kullanımlık dijital ürün.",
                    type: "digital",
                    media: [{ type: "image", url: parsed.data.mediaUrl, placement: 1 }],
                    priceData: {
                        currency: parsed.data.currency,
                        price: formatShopierMinorUnits(parsed.data.amountMinor),
                        discount: false,
                    },
                    stockQuantity: 1,
                    shippingPayer: "sellerPays",
                    customListing: true,
                }),
                signal: controller.signal,
            }
        );
        const responseText = await readBoundedResponse(response);
        let raw: unknown;
        try {
            raw = JSON.parse(responseText);
        } catch {
            throw new ShopierAdapterError("invalid_provider_response");
        }
        if (!response.ok) {
            if (response.status === 429) throw new ShopierAdapterError("provider_rate_limited");
            if (response.status >= 400 && response.status < 500) {
                throw new ShopierAdapterError("provider_rejected");
            }
            throw new ShopierAdapterError("provider_unavailable");
        }
        const product = productSchema.safeParse(raw);
        if (!product.success) throw new ShopierAdapterError("invalid_provider_response");
        const amountMinor = parseShopierMinorUnits(product.data.priceData.price);
        if (
            product.data.title !== title
            || product.data.priceData.currency !== parsed.data.currency
            || amountMinor !== parsed.data.amountMinor
            || product.data.stockQuantity !== 1
            || !isAllowedShopierHostedUrl(product.data.url, product.data.id)
        ) throw new ShopierAdapterError("invalid_provider_response");
        return {
            productId: product.data.id,
            checkoutUrl: product.data.url,
            amountMinor,
            currency: product.data.priceData.currency,
        };
    } catch (error) {
        if (error instanceof ShopierAdapterError) throw error;
        if (error instanceof Error && error.name === "AbortError") {
            throw new ShopierAdapterError("provider_timeout");
        }
        throw new ShopierAdapterError("provider_unavailable");
    } finally {
        clearTimeout(timeout);
    }
}
