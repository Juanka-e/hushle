import { z } from "zod";

export const PAYMENT_PROVIDER_IDS = [
    "shopier_v2",
    "iyzico",
    "paytr",
    "stripe",
    "lemonsqueezy",
] as const;

export type PaymentProviderId = (typeof PAYMENT_PROVIDER_IDS)[number];

export const PAYMENT_ORDER_STATUSES = [
    "created",
    "pending_provider",
    "awaiting_payment",
    "paid",
    "fulfilled",
    "failed",
    "expired",
    "refunded",
    "chargeback",
] as const;

export type PaymentOrderStatus = (typeof PAYMENT_ORDER_STATUSES)[number];

export const PAYMENT_PRODUCT_KINDS = [
    "cosmetic_item",
    "cosmetic_bundle",
    "coin_pack",
] as const;

export type PaymentProductKind = (typeof PAYMENT_PRODUCT_KINDS)[number];

export type PaymentGrantSnapshot = Record<string, unknown>;

export interface PaymentOrderQuote {
    productKind: PaymentProductKind;
    productReference: string;
    productVersion: number;
    productName: string;
    quantity: number;
    unitAmountMinor: number;
    currency: string;
    grantSnapshot: PaymentGrantSnapshot;
}

export const paymentOrderQuoteSchema = z.object({
    productKind: z.enum(PAYMENT_PRODUCT_KINDS),
    productReference: z.string().trim().min(1).max(120),
    productVersion: z.number().int().min(1).max(2_147_483_647),
    productName: z.string().trim().min(1).max(160),
    quantity: z.number().int().min(1).max(100),
    unitAmountMinor: z.number().int().min(1).max(2_147_483_647),
    currency: z.string().trim().regex(/^[A-Za-z]{3}$/),
    grantSnapshot: z.record(z.string(), z.unknown()),
});

export interface CreatePaymentOrderInput {
    userId: number;
    provider: PaymentProviderId;
    providerConfigVersion: number;
    idempotencyKey: string;
    quote: PaymentOrderQuote;
    expiresAt?: Date | null;
}

export interface PaymentOrderCreationResult<TOrder> {
    order: TOrder;
    reused: boolean;
}

export interface PaymentCheckoutLegalAcceptance {
    checkoutTermsVersion: string;
    privacyNoticeVersion: string;
    distanceSalesNoticeVersion: string;
    buyerDataPolicyVersion: string;
    acceptedAt: Date;
    requestId?: string | null;
    userAgentHash?: string | null;
}

export interface CreatePaymentCheckoutOrderInput extends CreatePaymentOrderInput {
    legalAcceptance: PaymentCheckoutLegalAcceptance;
}

export const paymentCheckoutLegalAcceptanceSchema = z.object({
    checkoutTermsVersion: z.string().trim().min(1).max(80),
    privacyNoticeVersion: z.string().trim().min(1).max(80),
    distanceSalesNoticeVersion: z.string().trim().min(1).max(80),
    buyerDataPolicyVersion: z.string().trim().min(1).max(80),
    acceptedAt: z.date(),
    requestId: z.string().trim().min(1).max(80).nullable().optional(),
    userAgentHash: z.string().regex(/^[a-f0-9]{64}$/).nullable().optional(),
});
