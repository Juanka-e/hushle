import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { emitObservabilityEvent } from "@hushle/platform-observability";
import { requireAdminSession } from "@/lib/admin/require-admin";
import {
    getPaymentCheckoutControl,
    getPaymentCheckoutActivationReadiness,
    isPaymentCheckoutExpansion,
    PaymentCheckoutControlConflictError,
    updatePaymentCheckoutControl,
} from "@/lib/payments/checkout-control";
import {
    buildRateLimitHeaders,
    consumeDistributedRequestRateLimit,
    getRequestIp,
} from "@/lib/security/request-rate-limit";

const EXPANSION_CONFIRMATION = "ODEMEYI AC";
const updateSchema = z.object({
    paused: z.boolean(),
    rolloutPercent: z.number().int().min(0).max(100),
    expectedRevision: z.number().int().min(0),
    reason: z.string().trim().min(3).max(300),
    confirmation: z.string().trim().max(40).optional(),
}).strict().refine((value) => value.paused || value.rolloutPercent > 0, {
    message: "Checkout acikken rollout yuzdesi en az 1 olmalidir.",
    path: ["rolloutPercent"],
});

export async function PATCH(request: NextRequest) {
    const admin = await requireAdminSession();
    if (admin instanceof NextResponse) return admin;
    const rateLimit = await consumeDistributedRequestRateLimit({
        bucket: "admin-payment-checkout-control",
        key: `admin:${admin.id}:${getRequestIp(request)}`,
        windowMs: 5 * 60_000,
        maxRequests: 12,
    });
    if (!rateLimit.allowed) {
        return NextResponse.json(
            { error: "Cok fazla odeme kontrolu degisikligi. Lutfen bekleyin." },
            { status: 429, headers: buildRateLimitHeaders(rateLimit) }
        );
    }

    const parsed = updateSchema.safeParse(await request.json().catch(() => null));
    if (!parsed.success) {
        return NextResponse.json(
            { error: parsed.error.issues[0]?.message ?? "Gecersiz odeme kontrolu." },
            { status: 422, headers: buildRateLimitHeaders(rateLimit) }
        );
    }

    let current;
    try {
        current = await getPaymentCheckoutControl({ fresh: true });
    } catch {
        return NextResponse.json(
            { error: "Odeme kontrolu okunamadi. Checkout fail-closed durumda kalacak." },
            { status: 503, headers: buildRateLimitHeaders(rateLimit) }
        );
    }
    if (!current.available) {
        return NextResponse.json(
            { error: "Odeme kontrol kaydi gecersiz. Checkout guvenli olarak kapali kalacak." },
            { status: 409, headers: buildRateLimitHeaders(rateLimit) }
        );
    }
    if (
        isPaymentCheckoutExpansion(current.control, parsed.data)
        && parsed.data.confirmation !== EXPANSION_CONFIRMATION
    ) {
        return NextResponse.json(
            { error: `Checkout erisimini genisletmek icin ${EXPANSION_CONFIRMATION} yazin.` },
            { status: 422, headers: buildRateLimitHeaders(rateLimit) }
        );
    }
    const activation = getPaymentCheckoutActivationReadiness();
    if (
        isPaymentCheckoutExpansion(current.control, parsed.data)
        && !(
            activation.runtimeReady
            && activation.legalReady
            && activation.providerSurfaceReady
            && activation.rolloutSeedConfigured
        )
    ) {
        return NextResponse.json(
            { error: "Runtime, hukuki kanit, provider yuzeyi ve rollout seed hazir olmadan checkout acilamaz." },
            { status: 409, headers: buildRateLimitHeaders(rateLimit) }
        );
    }

    try {
        const state = await updatePaymentCheckoutControl({
            paused: parsed.data.paused,
            rolloutPercent: parsed.data.rolloutPercent,
            expectedRevision: parsed.data.expectedRevision,
            reason: parsed.data.reason,
            updatedByUserId: admin.id,
            actorRole: admin.role,
            ipAddress: getRequestIp(request),
            userAgent: request.headers.get("user-agent"),
        });
        void emitObservabilityEvent({
            level: state.control.paused ? "warn" : "info",
            service: "hushle-web",
            event: state.control.paused
                ? "payment.checkout.paused"
                : "payment.checkout.rollout_updated",
            requestId: request.headers.get("x-request-id"),
            message: state.control.paused
                ? "New payment checkout sessions were paused by an operator."
                : "Payment checkout rollout was updated by an operator.",
            context: {
                paused: state.control.paused,
                rolloutPercent: state.control.rolloutPercent,
                revision: state.control.revision,
            },
        });
        return NextResponse.json(
            { checkoutControl: state },
            { headers: { ...buildRateLimitHeaders(rateLimit), "Cache-Control": "no-store" } }
        );
    } catch (error) {
        if (error instanceof PaymentCheckoutControlConflictError) {
            return NextResponse.json(
                { error: "Odeme kontrolu baska bir yonetici tarafindan degistirildi. Yenileyip tekrar deneyin." },
                { status: 409, headers: buildRateLimitHeaders(rateLimit) }
            );
        }
        return NextResponse.json(
            { error: "Odeme kontrolu guncellenemedi. Checkout mevcut guvenli durumda kaldi." },
            { status: 500, headers: buildRateLimitHeaders(rateLimit) }
        );
    }
}
