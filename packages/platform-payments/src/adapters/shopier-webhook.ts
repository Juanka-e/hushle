import { createHash, createHmac, timingSafeEqual } from "node:crypto";
import { z } from "zod";
import { PaymentWebhookError, type PaymentWebhookVerifier } from "../webhook-inbox";

const currencySchema = z.enum(["TRY", "USD", "EUR"]);
const moneySchema = z.string().regex(/^(?:0|[1-9]\d{0,9})(?:\.\d{1,2})?$/);
const orderSchema = z.object({
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
}).passthrough();

export interface ShopierWebhookCredentials {
    webhookToken: string;
    accountId: string;
}

function invalid(code: "invalid_signature" | "invalid_event" = "invalid_signature"): never {
    throw new PaymentWebhookError(code);
}

function parseMinorUnits(value: string): number | null {
    const [whole, fraction = ""] = value.split(".");
    const amount = Number(whole) * 100 + Number(fraction.padEnd(2, "0"));
    return Number.isSafeInteger(amount) && amount <= 2_147_483_647 ? amount : null;
}

function decodeSignature(value: string): Buffer | null {
    const trimmed = value.trim();
    if (/^[a-f0-9]{64}$/i.test(trimmed)) return Buffer.from(trimmed, "hex");
    if (/^[A-Za-z0-9+/]{43}=$/.test(trimmed)) return Buffer.from(trimmed, "base64");
    if (/^[A-Za-z0-9_-]{43}$/.test(trimmed)) return Buffer.from(trimmed, "base64url");
    return null;
}

function safeEqual(left: Buffer, right: Buffer): boolean {
    return left.length === right.length && timingSafeEqual(left, right);
}

export function buildShopierBuyerEmailHmac(email: string, webhookToken: string): string {
    return createHmac("sha256", webhookToken)
        .update(email.trim().toLowerCase(), "utf8")
        .digest("hex");
}

export function buildShopierWebhookEventId(rawBody: Uint8Array): string {
    return `shopier-body-sha256:${createHash("sha256").update(rawBody).digest("hex")}`;
}

export function createShopierWebhookVerifier(
    credentials: ShopierWebhookCredentials,
    options: { now?: () => Date; maxClockSkewSeconds?: number } = {}
): PaymentWebhookVerifier {
    if (!/^[\x21-\x7e]{20,2048}$/.test(credentials.webhookToken)) invalid();
    if (!/^[A-Za-z0-9._:-]{1,191}$/.test(credentials.accountId)) invalid();
    const now = options.now ?? (() => new Date());
    const maxClockSkewSeconds = Math.max(30, Math.min(options.maxClockSkewSeconds ?? 300, 900));
    return {
        provider: "shopier_v2",
        acknowledgement: { status: 200, contentType: "application/json", body: "{}" },
        async verify({ rawBody, headers }) {
            const accountId = headers["shopier-account-id"]?.trim();
            const eventType = headers["shopier-event"]?.trim();
            const eventId = headers["shopier-webhook-id"]?.trim();
            const timestampText = headers["shopier-timestamp"]?.trim();
            const signature = decodeSignature(headers["shopier-signature"] ?? "");
            if (
                accountId !== credentials.accountId
                || !eventType
                || !eventId
                || !/^[A-Za-z0-9._:-]{1,191}$/.test(eventId)
                || !/^\d{10}$/.test(timestampText ?? "")
                || !signature
            ) invalid();
            const timestamp = Number(timestampText);
            if (Math.abs(Math.floor(now().getTime() / 1000) - timestamp) > maxClockSkewSeconds) invalid();
            const expected = createHmac("sha256", credentials.webhookToken).update(rawBody).digest();
            if (!safeEqual(signature, expected)) invalid();
            let raw: unknown;
            try {
                raw = JSON.parse(Buffer.from(rawBody).toString("utf8"));
            } catch {
                invalid("invalid_event");
            }
            if (eventType === "refund.requested" || eventType === "refund.updated") {
                const refund = refundSchema.safeParse(raw);
                if (!refund.success) invalid("invalid_event");
                if (
                    (eventType === "refund.requested" && refund.data.status !== "pending")
                    || (eventType === "refund.updated" && refund.data.status === "pending")
                ) invalid("invalid_event");
                const amountMinor = parseMinorUnits(refund.data.total);
                if (amountMinor === null || amountMinor <= 0) invalid("invalid_event");
                const occurredAt = new Date(
                    refund.data.status === "succeeded"
                        ? refund.data.dateRefunded ?? refund.data.dateCreated
                        : refund.data.dateCreated
                );
                const refundCreatedAt = new Date(refund.data.dateCreated);
                if (!Number.isFinite(occurredAt.getTime()) || !Number.isFinite(refundCreatedAt.getTime())) {
                    invalid("invalid_event");
                }
                return {
                    providerEventId: buildShopierWebhookEventId(rawBody),
                    eventType,
                    outcome: "refund",
                    signatureVersion: "shopier-hs256-v1",
                    providerOrderReference: refund.data.orderId,
                    providerPaymentReference: refund.data.id,
                    amountMinor,
                    currency: refund.data.currency,
                    metadata: {
                        accountId,
                        timestamp,
                        refundStatus: refund.data.status,
                        refundType: refund.data.type,
                        refundCreatedAtEpochMs: refundCreatedAt.getTime(),
                        webhookId: eventId,
                    },
                    occurredAt,
                };
            }
            if (eventType !== "order.created") invalid("invalid_event");
            const order = orderSchema.safeParse(raw);
            if (!order.success) invalid("invalid_event");
            const line = order.data.lineItems[0];
            const total = parseMinorUnits(order.data.totals.total);
            const subtotal = parseMinorUnits(order.data.totals.subtotal);
            const shipping = parseMinorUnits(order.data.totals.shipping);
            const discount = parseMinorUnits(order.data.totals.discount);
            const price = parseMinorUnits(line.price);
            const lineTotal = parseMinorUnits(line.total);
            if (
                total === null || subtotal !== total || shipping !== 0 || discount !== 0
                || price !== total || lineTotal !== total
            ) invalid("invalid_event");
            const occurredAt = new Date(order.data.dateCreated);
            if (!Number.isFinite(occurredAt.getTime())) invalid("invalid_event");
            const metadata: Record<string, string | number | boolean | null> = {
                accountId,
                timestamp,
                productId: line.productId,
                productTitle: line.title,
                buyerEmailHmac: buildShopierBuyerEmailHmac(
                    order.data.shippingInfo.email,
                    credentials.webhookToken
                ),
                webhookId: eventId,
            };
            return {
                providerEventId: buildShopierWebhookEventId(rawBody),
                eventType,
                outcome: "payment_succeeded",
                signatureVersion: "shopier-hs256-v1",
                providerOrderReference: order.data.id,
                providerPaymentReference: order.data.id,
                amountMinor: total,
                currency: order.data.currency,
                metadata,
                occurredAt,
            };
        },
    };
}
