import type {
    IyzicoCheckoutError,
    PaytrCheckoutError,
    ShopierCheckoutError,
} from "@hushle/platform-payments";
import { PlayerErrorCode } from "@/lib/errors/player-error-codes";

type CheckoutProviderErrorCode =
    | IyzicoCheckoutError["code"]
    | PaytrCheckoutError["code"]
    | ShopierCheckoutError["code"];

// Same wire codes as before (the provider code in upper case), now backed by dictionary entries.
const CHECKOUT_PROVIDER_ERROR_CODES = {
    invalid_request: PlayerErrorCode.INVALID_REQUEST,
    order_not_found: PlayerErrorCode.ORDER_NOT_FOUND,
    order_not_eligible: PlayerErrorCode.ORDER_NOT_ELIGIBLE,
    checkout_in_progress: PlayerErrorCode.CHECKOUT_IN_PROGRESS,
    checkout_uncertain: PlayerErrorCode.CHECKOUT_UNCERTAIN,
    provider_timeout: PlayerErrorCode.PROVIDER_TIMEOUT,
    provider_unavailable: PlayerErrorCode.PROVIDER_UNAVAILABLE,
    provider_rate_limited: PlayerErrorCode.PROVIDER_RATE_LIMITED,
    provider_rejected: PlayerErrorCode.PROVIDER_REJECTED,
    invalid_provider_response: PlayerErrorCode.INVALID_PROVIDER_RESPONSE,
    checkout_state_conflict: PlayerErrorCode.CHECKOUT_STATE_CONFLICT,
} as const satisfies Record<CheckoutProviderErrorCode, PlayerErrorCode>;

export function getCheckoutProviderErrorCode(code: CheckoutProviderErrorCode): PlayerErrorCode {
    return CHECKOUT_PROVIDER_ERROR_CODES[code] ?? PlayerErrorCode.CHECKOUT_FAILED;
}
