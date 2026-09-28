import { randomUUID } from "node:crypto";
import { prisma } from "@hushle/platform-db";
import {
    PAYMENT_BUYER_DATA_POLICY_VERSION,
    createIyzicoSandboxCheckoutSession,
    createPaymentCheckoutOrderRecord,
    getActivePaymentOffer,
    iyzicoCheckoutBuyerDataSchema,
    normalizePaymentGrantSnapshot,
} from "@hushle/platform-payments";
import {
    IYZICO_ACCEPTANCE_EVIDENCE_SCHEMA,
    assertIyzicoAcceptanceEnvironment,
    assertSafeAcceptanceEvidence,
    buildAcceptanceCallbackUrl,
    hashProviderReference,
    readPositiveAmountLimit,
    readPositiveInteger,
} from "./lib/iyzico-sandbox-acceptance";

type Phase = "initialize" | "verify";

function readPhase(): Phase {
    const value = process.argv[2]?.trim().toLowerCase();
    if (value !== "initialize" && value !== "verify") {
        throw new Error("usage: npm run payment:iyzico-sandbox-acceptance -- <initialize|verify>");
    }
    return value;
}

function required(name: string): string {
    const value = process.env[name]?.trim();
    if (!value) throw new Error(`${name.toLowerCase()}_required`);
    return value;
}

function safePrint(evidence: unknown): void {
    assertSafeAcceptanceEvidence(evidence, [
        process.env.IYZICO_API_KEY ?? "",
        process.env.IYZICO_SECRET_KEY ?? "",
        process.env.IYZICO_ACCEPTANCE_IDENTITY_NUMBER ?? "",
        process.env.IYZICO_ACCEPTANCE_PHONE ?? "",
        process.env.IYZICO_ACCEPTANCE_ADDRESS ?? "",
        process.env.IYZICO_ACCEPTANCE_GIVEN_NAME ?? "",
        process.env.IYZICO_ACCEPTANCE_FAMILY_NAME ?? "",
        process.env.IYZICO_ACCEPTANCE_CITY ?? "",
        process.env.IYZICO_ACCEPTANCE_COUNTRY ?? "",
        process.env.IYZICO_ACCEPTANCE_ZIP_CODE ?? "",
    ]);
    console.log(JSON.stringify(evidence, null, 2));
}

async function initialize(): Promise<void> {
    const userId = readPositiveInteger(process.env, "IYZICO_ACCEPTANCE_USER_ID");
    const offerCode = required("IYZICO_ACCEPTANCE_OFFER_CODE");
    const requestIp = required("IYZICO_ACCEPTANCE_REQUEST_IP");
    if (requestIp.length < 3 || requestIp.length > 64) {
        throw new Error("iyzico_acceptance_request_ip_invalid");
    }
    const buyerDataResult = iyzicoCheckoutBuyerDataSchema.safeParse({
        givenName: required("IYZICO_ACCEPTANCE_GIVEN_NAME"),
        familyName: required("IYZICO_ACCEPTANCE_FAMILY_NAME"),
        identityNumber: required("IYZICO_ACCEPTANCE_IDENTITY_NUMBER"),
        phone: required("IYZICO_ACCEPTANCE_PHONE"),
        addressLine: required("IYZICO_ACCEPTANCE_ADDRESS"),
        city: required("IYZICO_ACCEPTANCE_CITY"),
        country: required("IYZICO_ACCEPTANCE_COUNTRY"),
        zipCode: process.env.IYZICO_ACCEPTANCE_ZIP_CODE?.trim() || undefined,
    });
    if (!buyerDataResult.success) throw new Error("iyzico_acceptance_buyer_data_invalid");
    const buyerData = buyerDataResult.data;
    const user = await prisma.user.findUnique({
        where: { id: userId },
        select: { id: true, email: true, emailVerifiedAt: true, accountStatus: true },
    });
    if (!user || !user.email || !user.emailVerifiedAt || user.accountStatus !== "active") {
        throw new Error("iyzico_acceptance_user_not_eligible");
    }
    const offer = await getActivePaymentOffer(offerCode);
    if (!offer) throw new Error("iyzico_acceptance_offer_not_found");
    if (offer.unitAmountMinor > readPositiveAmountLimit(process.env)) {
        throw new Error("iyzico_acceptance_offer_exceeds_amount_limit");
    }
    normalizePaymentGrantSnapshot({
        productKind: offer.productKind,
        quantity: 1,
        grantSnapshot: offer.grantSnapshot,
    });

    const orderResult = await createPaymentCheckoutOrderRecord({
        userId,
        provider: "iyzico",
        providerConfigVersion: 1,
        idempotencyKey: `iyzico-acceptance:${randomUUID()}`,
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
            requestId: "iyzico-sandbox-acceptance",
            userAgentHash: null,
        },
    });
    const checkout = await createIyzicoSandboxCheckoutSession({
        orderId: orderResult.order.id,
        userId,
        requestIp,
        buyerData,
        callbackUrl: buildAcceptanceCallbackUrl(
            required("IYZICO_ACCEPTANCE_PUBLIC_ORIGIN"),
            orderResult.order.id
        ),
        credentials: {
            apiKey: required("IYZICO_API_KEY"),
            secretKey: required("IYZICO_SECRET_KEY"),
        },
    });

    safePrint({
        schema: IYZICO_ACCEPTANCE_EVIDENCE_SCHEMA,
        phase: "initialized",
        status: "pending_operator_payment",
        generatedAt: new Date().toISOString(),
        provider: "iyzico",
        sandbox: true,
        orderId: checkout.orderId,
        ownerUserId: userId,
        amountMinor: offer.unitAmountMinor,
        currency: offer.currency,
        attemptNumber: checkout.attemptNumber,
        nextPath: `/checkout?order=${checkout.orderId}`,
        acceptanceFlagChanged: false,
    });
}

async function verify(): Promise<void> {
    const orderId = required("IYZICO_ACCEPTANCE_ORDER_ID");
    const userId = readPositiveInteger(process.env, "IYZICO_ACCEPTANCE_USER_ID");
    const order = await prisma.paymentOrder.findUnique({
        where: { id: orderId },
        include: {
            attempts: { orderBy: { attemptNumber: "asc" } },
            checkoutConsent: true,
            checkoutVerification: true,
            fulfillment: true,
            webhookEvents: { orderBy: { createdAt: "asc" } },
            reconciliationCase: true,
        },
    });
    if (!order || order.userId !== userId || order.provider !== "iyzico") {
        throw new Error("iyzico_acceptance_order_not_found");
    }
    const proof = order.checkoutVerification;
    const webhook = order.webhookEvents.find((event) =>
        event.status === "processed" && event.outcome === "payment_succeeded"
    );
    const checks = {
        orderFulfilled: order.status === "fulfilled" && Boolean(order.fulfilledAt),
        ownerBound: order.userId === userId,
        legalConsentCaptured: Boolean(order.checkoutConsent),
        initializeAttemptSucceeded: order.attempts.some((attempt) =>
            attempt.status === "succeeded"
            && attempt.providerRequestId?.startsWith("iyzico-token-sha256:")
        ),
        exactRetrieveProof: Boolean(
            proof
            && proof.provider === "iyzico"
            && proof.providerPaymentStatus === "SUCCESS"
            && proof.providerRiskStatus === 1
            && proof.amountMinor === order.totalAmountMinor
            && proof.paidAmountMinor === order.totalAmountMinor
            && proof.currency === order.currency
        ),
        signedWebhookProcessed: webhook?.signatureVersion === "v3",
        fulfillmentCompleted: order.fulfillment?.status === "completed"
            && Boolean(order.fulfillment.completedAt),
        notificationRecorded: Boolean(order.fulfillment?.notificationSentAt),
        reconciliationSettled: !order.reconciliationCase
            || order.reconciliationCase.status === "resolved",
        transientSessionCleared: !order.providerSessionReference && !order.providerHostedUrl,
    };
    const failedChecks = Object.entries(checks).filter(([, passed]) => !passed).map(([name]) => name);
    if (!proof?.providerPaymentReference) failedChecks.push("providerPaymentReferencePresent");

    const evidence = {
        schema: IYZICO_ACCEPTANCE_EVIDENCE_SCHEMA,
        phase: "verified",
        status: failedChecks.length === 0 ? "passed" : "failed",
        generatedAt: new Date().toISOString(),
        provider: "iyzico",
        sandbox: true,
        orderId: order.id,
        ownerUserId: order.userId,
        amountMinor: order.totalAmountMinor,
        currency: order.currency,
        merchantIdHash: hashProviderReference(required("IYZICO_MERCHANT_ID")),
        legalVersions: {
            checkoutTermsVersion: order.checkoutConsent?.checkoutTermsVersion ?? null,
            privacyNoticeVersion: order.checkoutConsent?.privacyNoticeVersion ?? null,
            distanceSalesNoticeVersion: order.checkoutConsent?.distanceSalesNoticeVersion ?? null,
            buyerDataPolicyVersion: order.checkoutConsent?.buyerDataPolicyVersion ?? null,
        },
        providerPaymentReferenceHash: proof?.providerPaymentReference
            ? hashProviderReference(proof.providerPaymentReference)
            : null,
        webhookEventId: webhook?.id ?? null,
        webhookDeliveryCount: webhook?.deliveryCount ?? 0,
        checks,
        failedChecks,
        acceptanceFlagChanged: false,
    };
    safePrint(evidence);
    if (failedChecks.length > 0) throw new Error(`iyzico_acceptance_verification_failed:${failedChecks.join(",")}`);
}

async function run(): Promise<void> {
    assertIyzicoAcceptanceEnvironment(process.env);
    const phase = readPhase();
    if (phase === "initialize") await initialize();
    else await verify();
}

run().catch((error) => {
    console.error(error instanceof Error ? error.message : "iyzico_acceptance_failed");
    process.exitCode = 1;
}).finally(() => prisma.$disconnect());
