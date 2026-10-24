import { PrismaMariaDb } from "@prisma/adapter-mariadb";
import { Prisma as PrismaNamespace, PrismaClient } from "./generated/prisma/client";
import { resolveDatabasePoolConfig } from "./connection";
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
} from "./generated/prisma/client";
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
} from "./generated/prisma/client";
export {
    DEFAULT_DATABASE_CONNECTION_LIMIT,
    resolveDatabasePoolConfig,
    type DatabasePoolConfig,
} from "./connection";
export { getUniqueConstraintTarget, isRetryableWriteConflict } from "./errors";

const globalForPrisma = globalThis as unknown as {
    prisma: PrismaClient | undefined;
};

type DriverAdapterFactory = PrismaNamespace.PrismaClientOptionsWithAdapter["adapter"];

/**
 * DATABASE_URL is read when Prisma first connects, as Prisma 6's engine did: a process without
 * it (the image build, unit tests) can still import this package, and only its queries fail.
 */
function createMariaDbAdapter(): DriverAdapterFactory {
    return {
        provider: "mysql",
        adapterName: "@prisma/adapter-mariadb",
        connect: async () => {
            const databaseUrl = process.env.DATABASE_URL;
            if (!databaseUrl) {
                throw new Error("DATABASE_URL is not set.");
            }
            return new PrismaMariaDb(resolveDatabasePoolConfig(databaseUrl)).connect();
        },
    };
}

/** A client of its own, for scripts; the app shares `prisma`. */
export function createPrismaClient(): PrismaClient {
    return new PrismaClient({
        adapter: createMariaDbAdapter(),
        log: process.env.NODE_ENV === "development" ? ["warn", "error"] : ["error"],
    });
}

export const prisma = globalForPrisma.prisma ?? createPrismaClient();

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
