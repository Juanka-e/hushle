import { NextResponse } from "next/server";
import {
    getSafePaymentBuyerDataDiagnostics,
    getPaymentRuntimeReadiness,
    listActivePaymentOffers,
} from "@hushle/platform-payments";
import { getSessionUser } from "@/lib/session";
import {
    buildRateLimitHeaders,
    consumeDistributedRequestRateLimit,
} from "@/lib/security/request-rate-limit";
import {
    getPaymentLegalReadiness,
    getPublicPaymentLegalDocuments,
} from "@/lib/payments/legal";
import {
    getIyzicoOwnerSurfaceReadiness,
    getPublicPaymentOrigin,
} from "@/lib/payments/iyzico-owner-surface";
import { getPaymentCheckoutAccess } from "@/lib/payments/checkout-control";
import { PlayerErrorCode, playerError } from "@/lib/errors/player-error";

export async function GET() {
    const sessionUser = await getSessionUser();
    if (!sessionUser) {
        return NextResponse.json(playerError(PlayerErrorCode.AUTH_REQUIRED), { status: 401 });
    }

    const rateLimit = await consumeDistributedRequestRateLimit({
        bucket: "payment-offers",
        key: `user:${sessionUser.id}`,
        windowMs: 60_000,
        maxRequests: 30,
    });
    if (!rateLimit.allowed) {
        return NextResponse.json(
            playerError(PlayerErrorCode.RATE_LIMITED),
            { status: 429, headers: buildRateLimitHeaders(rateLimit) }
        );
    }

    const [allOffers, runtime, legal, checkoutAccess] = await Promise.all([
        listActivePaymentOffers(),
        Promise.resolve(getPaymentRuntimeReadiness()),
        Promise.resolve(getPaymentLegalReadiness()),
        getPaymentCheckoutAccess(sessionUser.id),
    ]);
    const providerSurfaceReady = runtime.activeProvider !== "iyzico"
        || (getIyzicoOwnerSurfaceReadiness().sessionEnabled && Boolean(getPublicPaymentOrigin()));
    const checkoutAvailable = runtime.ready
        && legal.ready
        && providerSurfaceReady
        && checkoutAccess.available;
    return NextResponse.json(
        {
            offers: allOffers,
            checkout: {
                provider: runtime.activeProvider,
                available: checkoutAvailable,
                unavailableReason: checkoutAvailable
                    ? null
                    : "Ödeme altyapısı şu anda kullanıma hazır değil.",
                legalDocuments: getPublicPaymentLegalDocuments(legal),
                buyerDataPolicyVersion: runtime.activeProvider === "iyzico"
                    ? getSafePaymentBuyerDataDiagnostics("iyzico").policyVersion
                    : null,
            },
        },
        { headers: { ...buildRateLimitHeaders(rateLimit), "Cache-Control": "private, no-store" } }
    );
}
