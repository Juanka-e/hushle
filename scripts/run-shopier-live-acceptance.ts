import { randomUUID } from "node:crypto";
import { prisma } from "@hushle/platform-db";
import {
    PAYMENT_BUYER_DATA_POLICY_VERSION,
    approveProviderApiRefundRequest,
    createPaymentCheckoutOrderRecord,
    createShopierCheckoutListing,
    createShopierRefund,
    getActivePaymentOffer,
    getShopierRefund,
    listShopierRefundsByOrder,
    normalizePaymentGrantSnapshot,
    observeProviderRefund,
    parseShopierMinorUnits,
    recoverProviderApiRefundRequest,
    type PaymentRefundAdapter,
    type PaymentRefundRequest,
    type ShopierRefund,
} from "@hushle/platform-payments";
import { SHOPIER_ACCEPTANCE_EVIDENCE_SCHEMA } from "./lib/payment-activation-evidence.mjs";
import {
    assertSafeShopierAcceptanceOutput,
    assertShopierAcceptanceAmount,
    assertShopierAcceptanceEnvironment,
    hashShopierAcceptanceReference,
    readShopierAcceptanceCheckpoint,
    shopierPaymentCheckpointSchema,
    shopierRefundCheckpointSchema,
    writeShopierAcceptanceArtifact,
    type ShopierPaymentCheckpoint,
} from "./lib/shopier-live-acceptance";

type Phase = "dry-run" | "initialize" | "capture-payment" | "refund" | "verify";

function required(name: string): string {
    const value = process.env[name]?.trim();
    if (!value) throw new Error(`${name.toLowerCase()}_required`);
    return value;
}

function positiveInteger(name: string): number {
    const raw = required(name);
    if (!/^\d+$/.test(raw)) throw new Error(`${name.toLowerCase()}_invalid`);
    const value = Number(raw);
    if (!Number.isSafeInteger(value) || value <= 0) throw new Error(`${name.toLowerCase()}_invalid`);
    return value;
}

function phase(): Phase {
    const value = process.argv[2]?.trim().toLowerCase();
    if (!["dry-run", "initialize", "capture-payment", "refund", "verify"].includes(value ?? "")) {
        throw new Error("usage: npm run payment:shopier-live-acceptance -- <dry-run|initialize|capture-payment|refund|verify>");
    }
    return value as Phase;
}

function safePrint(value: unknown): void {
    assertSafeShopierAcceptanceOutput(value, [
        process.env.SHOPIER_PERSONAL_ACCESS_TOKEN ?? "",
        process.env.SHOPIER_WEBHOOK_TOKEN ?? "",
    ]);
    console.log(JSON.stringify(value, null, 2));
}

function credentials() {
    return { personalAccessToken: required("SHOPIER_PERSONAL_ACCESS_TOKEN") };
}

function normalizeRefund(refund: ShopierRefund, request: PaymentRefundRequest) {
    const amountMinor = parseShopierMinorUnits(refund.total);
    if (
        amountMinor === null
        || refund.orderId !== request.merchantOrderId
        || amountMinor !== request.amountMinor
        || refund.currency !== request.currency.toUpperCase()
        || refund.type !== "full"
    ) throw new Error("shopier_acceptance_refund_proof_mismatch");
    return {
        provider: "shopier_v2" as const,
        merchantOrderId: refund.orderId,
        amountMinor,
        currency: refund.currency,
        referenceNo: request.referenceNo,
        providerRefundReference: refund.id,
        status: refund.status,
        testMode: false,
    };
}

function acceptanceRefundAdapter(): PaymentRefundAdapter {
    return {
        provider: "shopier_v2",
        async refund(request) {
            return normalizeRefund(await createShopierRefund({
                orderId: request.merchantOrderId,
                amountMinor: request.amountMinor,
                currency: request.currency as "TRY",
                note: "Hushle düşük tutarlı canlı kabul iadesi.",
                credentials: credentials(),
            }), request);
        },
        async lookup(request) {
            if (request.providerRefundReference) {
                return normalizeRefund(await getShopierRefund({
                    refundId: request.providerRefundReference,
                    credentials: credentials(),
                }), request);
            }
            const refunds = await listShopierRefundsByOrder({
                orderId: request.merchantOrderId,
                dateStart: new Date(request.startedAt.getTime() - 5 * 60_000),
                dateEnd: new Date(request.startedAt.getTime() + 5 * 60_000),
                credentials: credentials(),
            });
            const matches = refunds.filter((refund) =>
                refund.orderId === request.merchantOrderId
                && refund.currency === request.currency
                && refund.type === "full"
                && parseShopierMinorUnits(refund.total) === request.amountMinor
            );
            if (matches.length === 0) return null;
            if (matches.length !== 1) throw new Error("shopier_acceptance_refund_ambiguous");
            return normalizeRefund(matches[0], request);
        },
    };
}

async function loadAcceptanceOffer() {
    const userId = positiveInteger("SHOPIER_ACCEPTANCE_USER_ID");
    const offerCode = required("SHOPIER_ACCEPTANCE_OFFER_CODE");
    const user = await prisma.user.findUnique({
        where: { id: userId },
        select: { id: true, email: true, emailVerifiedAt: true, accountStatus: true },
    });
    if (!user?.email || !user.emailVerifiedAt || user.accountStatus !== "active") {
        throw new Error("shopier_acceptance_user_not_eligible");
    }
    const offer = await getActivePaymentOffer(offerCode);
    if (!offer) throw new Error("shopier_acceptance_offer_not_found");
    assertShopierAcceptanceAmount({
        amountMinor: offer.unitAmountMinor,
        currency: offer.currency,
        environment: process.env,
    });
    normalizePaymentGrantSnapshot({
        productKind: offer.productKind,
        quantity: 1,
        grantSnapshot: offer.grantSnapshot,
    });
    return { userId, offer };
}

async function dryRun(): Promise<void> {
    const { userId, offer } = await loadAcceptanceOffer();
    const mediaUrl = required("SHOPIER_PRODUCT_MEDIA_URL");
    let validMediaUrl = false;
    try {
        const parsed = new URL(mediaUrl);
        validMediaUrl = parsed.protocol === "https:"
            && !parsed.username
            && !parsed.password
            && (parsed.port === "" || parsed.port === "443")
            && /\.(?:jpe?g|png|bmp)$/i.test(parsed.pathname);
    } catch {
        validMediaUrl = false;
    }
    if (!validMediaUrl) throw new Error("shopier_acceptance_media_url_invalid");
    safePrint({
        schema: SHOPIER_ACCEPTANCE_EVIDENCE_SCHEMA,
        phase: "dry_run",
        status: "passed",
        generatedAt: new Date().toISOString(),
        provider: "shopier_v2",
        live: true,
        ownerUserId: userId,
        offerCode: offer.code,
        amountMinor: offer.unitAmountMinor,
        currency: offer.currency,
        providerCalls: 0,
        databaseWrites: 0,
        publicPaymentsEnabled: false,
        acceptanceFlagChanged: false,
    });
}

async function initialize(): Promise<void> {
    const { userId, offer } = await loadAcceptanceOffer();
    const order = await createPaymentCheckoutOrderRecord({
        userId,
        provider: "shopier_v2",
        providerConfigVersion: 1,
        idempotencyKey: `shopier-acceptance:${randomUUID()}`,
        quote: {
            productKind: offer.productKind,
            productReference: offer.productReference,
            productVersion: offer.productVersion,
            productName: offer.productName,
            quantity: 1,
            unitAmountMinor: offer.unitAmountMinor,
            currency: offer.currency,
            grantSnapshot: offer.grantSnapshot as Record<string, unknown>,
        },
        legalAcceptance: {
            checkoutTermsVersion: required("PAYMENT_CHECKOUT_TERMS_VERSION"),
            privacyNoticeVersion: required("PAYMENT_PRIVACY_NOTICE_VERSION"),
            distanceSalesNoticeVersion: required("PAYMENT_DISTANCE_SALES_NOTICE_VERSION"),
            buyerDataPolicyVersion: PAYMENT_BUYER_DATA_POLICY_VERSION,
            acceptedAt: new Date(),
            requestId: "shopier-live-acceptance",
            userAgentHash: null,
        },
    });
    const listing = await createShopierCheckoutListing({
        orderId: order.order.id,
        mediaUrl: required("SHOPIER_PRODUCT_MEDIA_URL"),
        credentials: credentials(),
    });
    safePrint({
        schema: SHOPIER_ACCEPTANCE_EVIDENCE_SCHEMA,
        phase: "initialized",
        status: "pending_operator_payment",
        generatedAt: new Date().toISOString(),
        provider: "shopier_v2",
        live: true,
        orderId: listing.orderId,
        ownerUserId: userId,
        amountMinor: offer.unitAmountMinor,
        currency: offer.currency,
        checkoutUrl: listing.checkoutUrl,
        next: "Ödemeyi operatör hesabıyla tamamlayın; webhook worker sonrası capture-payment çalıştırın.",
        acceptanceFlagChanged: false,
    });
}

async function loadOrder(orderId: string) {
    return prisma.paymentOrder.findUnique({
        where: { id: orderId },
        include: {
            checkoutVerification: true,
            fulfillment: true,
            webhookEvents: { orderBy: { createdAt: "asc" } },
            reconciliationCase: true,
            reversal: true,
            reversalRequests: {
                include: { providerRefundAttempt: true },
                orderBy: { createdAt: "desc" },
            },
        },
    });
}

function paymentChecks(order: NonNullable<Awaited<ReturnType<typeof loadOrder>>>) {
    const signedPaymentWebhook = order.webhookEvents.find((event) =>
        event.outcome === "payment_succeeded"
        && event.status === "processed"
        && event.signatureVersion === "shopier-hs256-v1"
    );
    return {
        checkoutPaid: Boolean(
            ["fulfilled", "refunded"].includes(order.status)
            && order.paidAt
            && order.checkoutVerification?.provider === "shopier_v2"
            && order.checkoutVerification.providerPaymentStatus === "paid"
            && order.checkoutVerification.amountMinor === order.totalAmountMinor
            && order.checkoutVerification.paidAmountMinor === order.totalAmountMinor
            && order.checkoutVerification.currency === order.currency
        ),
        fulfillmentCompleted: order.fulfillment?.status === "completed"
            && Boolean(order.fulfillment.completedAt),
        signedWebhookProcessed: Boolean(signedPaymentWebhook),
        reconciliationSettled: !order.reconciliationCase
            || ["resolved", "ignored"].includes(order.reconciliationCase.status),
    };
}

async function capturePayment(): Promise<void> {
    const orderId = required("SHOPIER_ACCEPTANCE_ORDER_ID");
    const ownerUserId = positiveInteger("SHOPIER_ACCEPTANCE_USER_ID");
    const order = await loadOrder(orderId);
    if (!order || order.userId !== ownerUserId || order.provider !== "shopier_v2" || !order.providerOrderReference) {
        throw new Error("shopier_acceptance_order_not_found");
    }
    assertShopierAcceptanceAmount({
        amountMinor: order.totalAmountMinor,
        currency: order.currency,
        environment: process.env,
    });
    const checks = paymentChecks(order);
    if (Object.values(checks).some((value) => !value)) {
        throw new Error(`shopier_acceptance_payment_incomplete:${Object.entries(checks).filter(([, ok]) => !ok).map(([key]) => key).join(",")}`);
    }
    const checkpoint: ShopierPaymentCheckpoint = {
        schema: "shopier-live-acceptance-checkpoint-v1",
        phase: "payment_verified",
        capturedAt: new Date().toISOString(),
        orderId: order.id,
        ownerUserId: order.userId,
        amountMinor: order.totalAmountMinor,
        currency: "TRY",
        accountIdHash: hashShopierAcceptanceReference(required("SHOPIER_ACCOUNT_ID")),
        providerOrderReferenceHash: hashShopierAcceptanceReference(order.providerOrderReference),
        checks: {
            checkoutPaid: true,
            fulfillmentCompleted: true,
            signedWebhookProcessed: true,
            reconciliationSettled: true,
        },
    };
    const outputPath = required("SHOPIER_ACCEPTANCE_PAYMENT_CHECKPOINT_FILE");
    const digest = writeShopierAcceptanceArtifact(outputPath, checkpoint);
    safePrint({ phase: checkpoint.phase, orderId: order.id, outputPath, digest, next: "Admin panelde provider API refund isteği oluşturun; ikinci admin bilgisiyle refund fazını çalıştırın." });
}

async function refund(): Promise<void> {
    const paymentCheckpoint = readShopierAcceptanceCheckpoint(
        required("SHOPIER_ACCEPTANCE_PAYMENT_CHECKPOINT_FILE"),
        shopierPaymentCheckpointSchema
    );
    const requestId = required("SHOPIER_ACCEPTANCE_REVERSAL_REQUEST_ID");
    const reviewerUserId = positiveInteger("SHOPIER_ACCEPTANCE_REVIEWER_USER_ID");
    const request = await prisma.paymentReversalRequest.findUnique({
        where: { id: requestId },
        include: { order: true, providerRefundAttempt: true },
    });
    if (
        !request
        || request.orderId !== paymentCheckpoint.orderId
        || request.order.userId !== paymentCheckpoint.ownerUserId
        || request.order.provider !== "shopier_v2"
        || request.executionMode !== "provider_api"
        || request.outcome !== "refund"
        || request.order.totalAmountMinor !== paymentCheckpoint.amountMinor
        || request.order.currency !== paymentCheckpoint.currency
        || !request.order.providerOrderReference
        || hashShopierAcceptanceReference(required("SHOPIER_ACCOUNT_ID")) !== paymentCheckpoint.accountIdHash
        || hashShopierAcceptanceReference(request.order.providerOrderReference) !== paymentCheckpoint.providerOrderReferenceHash
    ) throw new Error("shopier_acceptance_reversal_request_invalid");
    assertShopierAcceptanceAmount({
        amountMinor: request.order.totalAmountMinor,
        currency: request.order.currency,
        environment: process.env,
    });
    if (!request.providerRefundAttempt) {
        if (request.status !== "pending") throw new Error("shopier_acceptance_reversal_request_invalid");
        await approveProviderApiRefundRequest({
            requestId,
            reviewedByUserId: reviewerUserId,
            reviewNote: "Shopier düşük tutarlı canlı kabul iadesi ikinci onayı.",
            adapter: acceptanceRefundAdapter(),
        });
    } else {
        if (request.reviewedByUserId !== reviewerUserId
            || !["processing", "provider_review", "approved"].includes(request.status)) {
            throw new Error("shopier_acceptance_reversal_request_invalid");
        }
        if (!request.providerRefundAttempt.providerRefundReference
            && ["processing", "provider_review"].includes(request.status)) {
            await recoverProviderApiRefundRequest({
                requestId,
                checkedByUserId: reviewerUserId,
                adapter: acceptanceRefundAdapter(),
            });
        }
    }
    const updated = await prisma.paymentReversalRequest.findUniqueOrThrow({
        where: { id: requestId },
        include: { providerRefundAttempt: true },
    });
    const attempt = updated.providerRefundAttempt;
    if (!attempt?.providerRefundReference || !updated.reviewedAt || !attempt.startedAt) {
        throw new Error("shopier_acceptance_refund_not_persisted");
    }
    const checkpoint = {
        schema: "shopier-live-acceptance-checkpoint-v1" as const,
        phase: "refund_requested" as const,
        capturedAt: new Date().toISOString(),
        orderId: paymentCheckpoint.orderId,
        ownerUserId: paymentCheckpoint.ownerUserId,
        amountMinor: paymentCheckpoint.amountMinor,
        currency: paymentCheckpoint.currency,
        accountIdHash: paymentCheckpoint.accountIdHash,
        providerOrderReferenceHash: paymentCheckpoint.providerOrderReferenceHash,
        reversalRequestId: requestId,
        providerRefundReferenceHash: hashShopierAcceptanceReference(attempt.providerRefundReference),
        // The local processing row is committed before the provider POST, so a crash cannot erase intent.
        refundPendingObserved: true as const,
    };
    const outputPath = required("SHOPIER_ACCEPTANCE_REFUND_CHECKPOINT_FILE");
    const digest = writeShopierAcceptanceArtifact(outputPath, checkpoint);
    safePrint({ phase: checkpoint.phase, orderId: checkpoint.orderId, providerStatus: attempt.status, outputPath, digest, next: "Shopier iadesi succeeded olduğunda verify fazını çalıştırın.", acceptanceFlagChanged: false });
}

async function verify(): Promise<void> {
    const checkpoint = readShopierAcceptanceCheckpoint(
        required("SHOPIER_ACCEPTANCE_REFUND_CHECKPOINT_FILE"),
        shopierRefundCheckpointSchema
    );
    const checkedByUserId = positiveInteger("SHOPIER_ACCEPTANCE_REVIEWER_USER_ID");
    const ownerUserId = positiveInteger("SHOPIER_ACCEPTANCE_USER_ID");
    let request = await prisma.paymentReversalRequest.findUniqueOrThrow({
        where: { id: checkpoint.reversalRequestId },
        include: { providerRefundAttempt: true, order: true },
    });
    if (
        request.orderId !== checkpoint.orderId
        || request.order.userId !== ownerUserId
        || checkpoint.ownerUserId !== ownerUserId
        || request.order.totalAmountMinor !== checkpoint.amountMinor
        || request.order.currency !== checkpoint.currency
        || !request.order.providerOrderReference
        || hashShopierAcceptanceReference(required("SHOPIER_ACCOUNT_ID")) !== checkpoint.accountIdHash
        || hashShopierAcceptanceReference(request.order.providerOrderReference) !== checkpoint.providerOrderReferenceHash
        || !request.providerRefundAttempt?.providerRefundReference
        || hashShopierAcceptanceReference(request.providerRefundAttempt.providerRefundReference) !== checkpoint.providerRefundReferenceHash
    ) throw new Error("shopier_acceptance_refund_checkpoint_mismatch");
    if (["processing", "provider_review"].includes(request.status)) {
        await recoverProviderApiRefundRequest({
            requestId: request.id,
            checkedByUserId,
            adapter: acceptanceRefundAdapter(),
        });
        request = await prisma.paymentReversalRequest.findUniqueOrThrow({
            where: { id: checkpoint.reversalRequestId },
            include: { providerRefundAttempt: true, order: true },
        });
    }
    const attempt = request.providerRefundAttempt;
    if (!attempt?.providerRefundReference || attempt.status !== "succeeded") {
        throw new Error("shopier_acceptance_refund_not_succeeded");
    }
    const providerRefund = await getShopierRefund({ refundId: attempt.providerRefundReference, credentials: credentials() });
    const duplicateLookup = await getShopierRefund({ refundId: attempt.providerRefundReference, credentials: credentials() });
    if (JSON.stringify(providerRefund) !== JSON.stringify(duplicateLookup) || providerRefund.status !== "succeeded") {
        throw new Error("shopier_acceptance_refund_lookup_unstable");
    }
    const duplicateInput = {
        provider: "shopier_v2" as const,
        providerOrderReference: request.order.providerOrderReference ?? "",
        providerRefundReference: providerRefund.id,
        amountMinor: request.order.totalAmountMinor,
        currency: request.order.currency,
        status: "succeeded" as const,
        refundType: "full" as const,
        refundCreatedAt: new Date(providerRefund.dateCreated),
    };
    const reversalCountBefore = await prisma.paymentReversal.count({ where: { orderId: checkpoint.orderId } });
    const duplicateOne = await observeProviderRefund(duplicateInput);
    const duplicateTwo = await observeProviderRefund(duplicateInput);
    const reversalCountAfter = await prisma.paymentReversal.count({ where: { orderId: checkpoint.orderId } });
    const order = await loadOrder(checkpoint.orderId);
    if (!order?.providerOrderReference) throw new Error("shopier_acceptance_order_not_found");
    const baseChecks = paymentChecks(order);
    const checks = {
        checkoutPaid: baseChecks.checkoutPaid,
        duplicateRefundIdempotent: duplicateOne === "duplicate"
            && duplicateTwo === "duplicate"
            && reversalCountBefore === 1
            && reversalCountAfter === 1,
        entitlementReversed: order.status === "refunded"
            && order.reversal?.status === "completed"
            && Boolean(order.fulfillment?.reversedAt),
        reconciliationSettled: baseChecks.reconciliationSettled,
        refundPendingObserved: checkpoint.refundPendingObserved,
        refundSucceededObserved: attempt.status === "succeeded"
            && providerRefund.status === "succeeded",
        signedWebhookProcessed: baseChecks.signedWebhookProcessed,
    };
    const failedChecks = Object.entries(checks).filter(([, ok]) => !ok).map(([key]) => key);
    const evidence = {
        schema: SHOPIER_ACCEPTANCE_EVIDENCE_SCHEMA,
        phase: "verified",
        status: failedChecks.length === 0 ? "passed" : "failed",
        generatedAt: new Date().toISOString(),
        provider: "shopier_v2",
        live: true,
        amountMinor: order.totalAmountMinor,
        currency: order.currency,
        accountIdHash: hashShopierAcceptanceReference(required("SHOPIER_ACCOUNT_ID")),
        providerOrderReferenceHash: hashShopierAcceptanceReference(order.providerOrderReference),
        providerRefundReferenceHash: hashShopierAcceptanceReference(providerRefund.id),
        checks,
        failedChecks,
        acceptanceFlagChanged: false,
    };
    if (failedChecks.length > 0) {
        safePrint(evidence);
        throw new Error(`shopier_acceptance_verification_failed:${failedChecks.join(",")}`);
    }
    const outputPath = required("SHOPIER_ACCEPTANCE_EVIDENCE_FILE");
    const digest = writeShopierAcceptanceArtifact(outputPath, evidence);
    safePrint({ phase: evidence.phase, status: evidence.status, outputPath, digest, acceptanceFlagChanged: false });
}

async function run(): Promise<void> {
    const selectedPhase = phase();
    assertShopierAcceptanceEnvironment(process.env, {
        providerMutation: selectedPhase === "initialize" || selectedPhase === "refund" || selectedPhase === "verify",
    });
    if (selectedPhase === "dry-run") await dryRun();
    else if (selectedPhase === "initialize") await initialize();
    else if (selectedPhase === "capture-payment") await capturePayment();
    else if (selectedPhase === "refund") await refund();
    else await verify();
}

run().catch((error) => {
    console.error(error instanceof Error ? error.message : "shopier_acceptance_failed");
    process.exitCode = 1;
}).finally(() => prisma.$disconnect());
