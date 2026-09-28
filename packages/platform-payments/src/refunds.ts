import { z } from "zod";
import type { PaymentProviderId } from "./contracts";
import {
    PaytrAdapterError,
    queryPaytrPaymentStatus,
    requestPaytrRefund,
    type PaytrCredentials,
} from "./adapters/paytr";
import {
    createShopierRefund,
    getShopierRefund,
    listShopierRefundsByOrder,
    parseShopierMinorUnits,
    ShopierAdapterError,
    type ShopierCredentials,
    type ShopierRefund,
} from "./adapters/shopier";
import type { PaymentEnvironment } from "./provider-registry";

export const paymentRefundRequestSchema = z.object({
    merchantOrderId: z.string().trim().regex(/^[A-Za-z0-9._:-]{1,191}$/),
    amountMinor: z.number().int().min(1).max(2_147_483_647),
    currency: z.string().trim().regex(/^[A-Za-z]{3}$/).transform((value) => value.toUpperCase()),
    referenceNo: z.string().trim().regex(/^[A-Za-z0-9]{1,64}$/),
});

export type PaymentRefundRequest = z.input<typeof paymentRefundRequestSchema>;
export type PaymentRefundResult = {
    provider: PaymentProviderId;
    merchantOrderId: string;
    amountMinor: number;
    currency: string;
    referenceNo: string;
    providerRefundReference: string;
    status: "pending" | "failed" | "succeeded";
    testMode: boolean;
};

export interface PaymentRefundAdapter {
    readonly provider: PaymentProviderId;
    refund(request: PaymentRefundRequest): Promise<PaymentRefundResult>;
    lookup(request: PaymentRefundRequest & {
        providerRefundReference?: string | null;
        startedAt: Date;
    }): Promise<PaymentRefundResult | null>;
}

export type PaymentRefundReadiness = {
    provider: PaymentProviderId;
    mode: "disabled" | "sandbox" | "live" | "invalid";
    ready: boolean;
    issues: string[];
};

function configured(value: string | undefined): boolean {
    const normalized = value?.trim().toLowerCase() ?? "";
    return Boolean(normalized && !normalized.includes("replace_with_"));
}

export function getPaymentRefundReadiness(
    provider: PaymentProviderId,
    environment: PaymentEnvironment = process.env
): PaymentRefundReadiness {
    if (provider !== "paytr" && provider !== "shopier_v2") {
        return { provider, mode: "disabled", ready: false, issues: ["refund_adapter_unavailable"] };
    }
    if (provider === "shopier_v2") {
        const rawMode = environment.SHOPIER_REFUND_MODE?.trim().toLowerCase() || "disabled";
        const mode = rawMode === "disabled" || rawMode === "live" ? rawMode : "invalid";
        const issues: string[] = [];
        if (mode === "disabled") issues.push("refund_disabled");
        if (mode === "invalid") issues.push("refund_mode_invalid");
        if (mode === "live" && environment.SHOPIER_CHECKOUT_MODE?.trim().toLowerCase() !== "live") {
            issues.push("refund_checkout_mode_mismatch");
        }
        if (mode === "live") {
            if (!/^[\x21-\x7e]{20,2048}$/.test(environment.SHOPIER_PERSONAL_ACCESS_TOKEN ?? "")) {
                issues.push("shopier_personal_access_token_invalid");
            }
            if (environment.SHOPIER_LIVE_ACCEPTANCE_RECORDED?.trim().toLowerCase() !== "true") {
                issues.push("shopier_live_acceptance_missing");
            }
            if (!/^sha256:[a-f0-9]{64}$/.test(
                environment.SHOPIER_LIVE_ACCEPTANCE_EVIDENCE_SHA256?.trim() ?? ""
            )) issues.push("shopier_live_acceptance_evidence_invalid");
        }
        return { provider, mode, ready: mode === "live" && issues.length === 0, issues };
    }
    const rawMode = environment.PAYTR_REFUND_MODE?.trim().toLowerCase() || "disabled";
    const mode = rawMode === "disabled" || rawMode === "sandbox" ? rawMode : "invalid";
    const issues: string[] = [];
    if (mode === "disabled") issues.push("refund_disabled");
    if (mode === "invalid") issues.push("refund_mode_invalid");
    if (mode === "sandbox" && environment.PAYTR_CHECKOUT_MODE?.trim().toLowerCase() !== "sandbox") {
        issues.push("refund_checkout_mode_mismatch");
    }
    if (mode === "sandbox") {
        const merchantId = environment.PAYTR_MERCHANT_ID?.trim() ?? "";
        const merchantKey = environment.PAYTR_MERCHANT_KEY ?? "";
        const merchantSalt = environment.PAYTR_MERCHANT_SALT ?? "";
        if (!configured(merchantId)) issues.push("paytr_merchant_id_missing");
        else if (!/^\d{1,64}$/.test(merchantId)) issues.push("paytr_merchant_id_invalid");
        if (!configured(merchantKey)) issues.push("paytr_merchant_key_missing");
        else if (merchantKey.length > 512) issues.push("paytr_merchant_key_invalid");
        if (!configured(merchantSalt)) issues.push("paytr_merchant_salt_missing");
        else if (merchantSalt.length > 512) issues.push("paytr_merchant_salt_invalid");
    }
    return { provider, mode, ready: mode === "sandbox" && issues.length === 0, issues };
}

export function createPaymentRefundAdapter(input: {
    provider: PaymentProviderId;
    environment?: PaymentEnvironment;
    fetchImpl?: typeof fetch;
}): PaymentRefundAdapter | null {
    const environment = input.environment ?? process.env;
    if (!getPaymentRefundReadiness(input.provider, environment).ready) {
        return null;
    }
    if (input.provider === "shopier_v2") {
        const credentials: ShopierCredentials = {
            personalAccessToken: environment.SHOPIER_PERSONAL_ACCESS_TOKEN ?? "",
        };
        const normalize = (
            refund: ShopierRefund,
            request: PaymentRefundRequest
        ): PaymentRefundResult => {
            const amountMinor = parseShopierMinorUnits(refund.total);
            if (
                amountMinor === null
                || refund.orderId !== request.merchantOrderId
                || amountMinor !== request.amountMinor
                || refund.currency !== request.currency.toUpperCase()
                || refund.type !== "full"
            ) throw new ShopierAdapterError("invalid_provider_response");
            return {
                provider: "shopier_v2",
                merchantOrderId: refund.orderId,
                amountMinor,
                currency: refund.currency,
                referenceNo: request.referenceNo,
                providerRefundReference: refund.id,
                status: refund.status,
                testMode: false,
            };
        };
        return {
            provider: "shopier_v2",
            async refund(request) {
                const parsed = paymentRefundRequestSchema.safeParse(request);
                if (!parsed.success || !(["TRY", "USD", "EUR"] as const).includes(
                    parsed.data.currency as "TRY" | "USD" | "EUR"
                )) {
                    throw new ShopierAdapterError("invalid_request");
                }
                return normalize(await createShopierRefund({
                    orderId: parsed.data.merchantOrderId,
                    amountMinor: parsed.data.amountMinor,
                    currency: parsed.data.currency as "TRY" | "USD" | "EUR",
                    note: "Hushle sipariş iadesi.",
                    credentials,
                    fetchImpl: input.fetchImpl,
                }), parsed.data);
            },
            async lookup(request) {
                const parsed = paymentRefundRequestSchema.safeParse(request);
                if (!parsed.success) throw new ShopierAdapterError("invalid_request");
                if (request.providerRefundReference) {
                    return normalize(await getShopierRefund({
                        refundId: request.providerRefundReference,
                        credentials,
                        fetchImpl: input.fetchImpl,
                    }), parsed.data);
                }
                const refunds = await listShopierRefundsByOrder({
                    orderId: parsed.data.merchantOrderId,
                    dateStart: new Date(request.startedAt.getTime() - 5 * 60_000),
                    dateEnd: new Date(request.startedAt.getTime() + 5 * 60_000),
                    credentials,
                    fetchImpl: input.fetchImpl,
                });
                const matches = refunds.filter((refund) =>
                    refund.orderId === parsed.data.merchantOrderId
                    && refund.currency === parsed.data.currency
                    && refund.type === "full"
                    && parseShopierMinorUnits(refund.total) === parsed.data.amountMinor
                );
                if (matches.length === 0) return null;
                if (matches.length !== 1) throw new ShopierAdapterError("invalid_provider_response");
                return normalize(matches[0], parsed.data);
            },
        };
    }
    const credentials: PaytrCredentials = {
        merchantId: environment.PAYTR_MERCHANT_ID ?? "",
        merchantKey: environment.PAYTR_MERCHANT_KEY ?? "",
        merchantSalt: environment.PAYTR_MERCHANT_SALT ?? "",
    };
    return {
        provider: "paytr",
        async refund(request) {
            const parsed = paymentRefundRequestSchema.safeParse(request);
            if (!parsed.success) throw new PaytrAdapterError("invalid_request");
            if (!(["TRY", "USD", "EUR", "GBP", "RUB"] as const).includes(
                parsed.data.currency as "TRY" | "USD" | "EUR" | "GBP" | "RUB"
            )) {
                throw new PaytrAdapterError("invalid_request");
            }
            const result = await requestPaytrRefund({
                merchantOrderId: parsed.data.merchantOrderId,
                amountMinor: parsed.data.amountMinor,
                referenceNo: parsed.data.referenceNo,
                credentials,
                fetchImpl: input.fetchImpl,
            });
            return {
                provider: "paytr",
                currency: parsed.data.currency,
                status: "succeeded",
                providerRefundReference: result.referenceNo,
                ...result,
            };
        },
        async lookup(request) {
            const parsed = paymentRefundRequestSchema.safeParse(request);
            if (!parsed.success) throw new PaytrAdapterError("invalid_request");
            const status = await queryPaytrPaymentStatus({
                merchantOrderId: parsed.data.merchantOrderId,
                credentials,
                fetchImpl: input.fetchImpl,
            });
            if (status.status !== "success" || !status.testMode) return null;
            const refund = (status.refunds ?? []).find((entry) => entry.referenceNo === parsed.data.referenceNo);
            if (!refund) return null;
            return {
                provider: "paytr",
                merchantOrderId: parsed.data.merchantOrderId,
                amountMinor: refund.amountMinor,
                currency: status.currency,
                referenceNo: refund.referenceNo,
                providerRefundReference: refund.referenceNo,
                status: refund.completed ? "succeeded" : "pending",
                testMode: true,
            };
        },
    };
}
