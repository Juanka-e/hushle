import { Prisma as PrismaNamespace, PrismaClient } from "@prisma/client";
export {
    CosmeticRenderMode,
    EmailMessageClass,
    EmailDeliveryEventType,
    EmailOutboxStatus,
    EmailSuppressionReason,
    EmailSuppressionScope,
    ItemRarity,
    MobileAuthTokenKind,
    PaymentAttemptStatus,
    PaymentFulfillmentStatus,
    PaymentManualReviewStatus,
    PaymentProviderRefundAttemptStatus,
    PaymentReversalExecutionMode,
    PaymentOrderStatus,
    PaymentProductKind,
    PaymentProvider,
    PaymentReconciliationStatus,
    PaymentReversalOutcome,
    PaymentReversalRequestStatus,
    PaymentReversalStatus,
    PaymentWebhookOutcome,
    PaymentWebhookProcessingStatus,
    Prisma,
    PrismaClient,
    PromotionDiscountType,
    PromotionTargetType,
    ShopItemType,
    UserAccountStatus,
    WalletLedgerSource,
} from "@prisma/client";
export type {
    PaymentManualReviewCase,
    PaymentProviderRefundAttempt,
    PaymentCheckoutVerification,
    PaymentCoinLot,
    PaymentCoinLotAllocation,
    PaymentOffer,
    PaymentOrder,
    PaymentReconciliationCase,
    PaymentReversal,
    PaymentReversalRequest,
    PaymentWebhookEvent,
} from "@prisma/client";

const globalForPrisma = globalThis as unknown as {
    prisma: PrismaClient | undefined;
};

let dbUrl = process.env.DATABASE_URL;
if (dbUrl && !dbUrl.includes("connection_limit")) {
    const configuredLimit = Number(process.env.DATABASE_CONNECTION_LIMIT);
    const connectionLimit =
        Number.isInteger(configuredLimit) &&
        configuredLimit >= 1 &&
        configuredLimit <= 100
            ? configuredLimit
            : 20;
    dbUrl = `${dbUrl}${dbUrl.includes("?") ? "&" : "?"}connection_limit=${connectionLimit}`;
}

export const prisma =
    globalForPrisma.prisma ??
    new PrismaClient({
        log: process.env.NODE_ENV === "development" ? ["warn", "error"] : ["error"],
        datasources: dbUrl ? { db: { url: dbUrl } } : undefined,
    });

if (process.env.NODE_ENV !== "production") {
    globalForPrisma.prisma = prisma;
}

/**
 * Creates the user's empty profile if it does not exist yet. Safe when several
 * requests open the same profile at once: Prisma's upsert is a read followed by
 * an INSERT, so two first opens could both insert and one failed on
 * user_profiles_user_id_key. ON DUPLICATE KEY UPDATE takes an exclusive lock on
 * the duplicate, so later openers wait for the first insert and reuse its row.
 * Call it with the plain client before a transaction that may roll back.
 */
export async function ensureUserProfile(
    client: PrismaNamespace.TransactionClient,
    userId: number
): Promise<void> {
    const existing = await client.userProfile.findUnique({
        where: { userId },
        select: { id: true },
    });
    if (existing) return;
    const now = new Date();
    await client.$executeRaw`
        INSERT INTO user_profiles (user_id, created_at, updated_at)
        VALUES (${userId}, ${now}, ${now})
        ON DUPLICATE KEY UPDATE user_id = user_id
    `;
}
