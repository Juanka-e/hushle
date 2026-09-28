import type { PaymentProviderId } from "./contracts";
import { createPaytrWebhookVerifier } from "./adapters/paytr";
import { createIyzicoHppWebhookVerifier } from "./adapters/iyzico-webhook";
import { createShopierWebhookVerifier } from "./adapters/shopier-webhook";
import type { PaymentWebhookVerifier } from "./webhook-inbox";

type WebhookEnvironment = Record<string, string | undefined>;

export function getPaymentWebhookVerifier(
    provider: PaymentProviderId,
    environment: WebhookEnvironment = process.env
): PaymentWebhookVerifier | null {
    try {
        if (
            provider === "shopier_v2"
            && environment.SHOPIER_CHECKOUT_MODE?.trim().toLowerCase() === "live"
            && environment.SHOPIER_WEBHOOK_MODE?.trim().toLowerCase() === "live"
        ) {
            return createShopierWebhookVerifier({
                webhookToken: environment.SHOPIER_WEBHOOK_TOKEN ?? "",
                accountId: environment.SHOPIER_ACCOUNT_ID ?? "",
            });
        }
        if (
            provider === "paytr"
            && environment.PAYTR_CHECKOUT_MODE?.trim().toLowerCase() === "sandbox"
        ) {
            return createPaytrWebhookVerifier({
                merchantId: environment.PAYTR_MERCHANT_ID ?? "",
                merchantKey: environment.PAYTR_MERCHANT_KEY ?? "",
                merchantSalt: environment.PAYTR_MERCHANT_SALT ?? "",
            });
        }
        if (
            provider === "iyzico"
            && environment.IYZICO_CHECKOUT_MODE?.trim().toLowerCase() === "sandbox"
            && environment.IYZICO_WEBHOOK_MODE?.trim().toLowerCase() === "sandbox"
        ) {
            return createIyzicoHppWebhookVerifier({
                secretKey: environment.IYZICO_SECRET_KEY ?? "",
                merchantId: environment.IYZICO_MERCHANT_ID ?? "",
            });
        }
        return null;
    } catch {
        return null;
    }
}
