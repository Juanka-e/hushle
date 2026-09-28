import { prisma } from "@/lib/prisma";
import type { AdminWalletLedgerResponse } from "@/types/admin-wallet-ledger";

export async function getAdminWalletLedger(
    userId: number,
    input: { page: number; limit: number }
): Promise<AdminWalletLedgerResponse | null> {
    const user = await prisma.user.findUnique({
        where: { id: userId },
        select: {
            id: true,
            username: true,
            wallet: {
                select: {
                    id: true,
                    coinBalance: true,
                },
            },
        },
    });
    if (!user) {
        return null;
    }

    const walletId = user.wallet?.id;
    const coinBalance = user.wallet?.coinBalance ?? 0;
    if (!walletId) {
        return {
            userId: user.id,
            username: user.username,
            coinBalance: 0,
            reconciliationStatus: "not_initialized",
            latestLedgerBalance: null,
            entries: [],
            page: 1,
            pages: 1,
            total: 0,
        };
    }

    const [total, latestEntry] = await Promise.all([
        prisma.walletLedgerEntry.count({ where: { walletId } }),
        prisma.walletLedgerEntry.findFirst({
            where: { walletId },
            orderBy: [{ createdAt: "desc" }, { id: "desc" }],
            select: { balanceAfter: true },
        }),
    ]);
    const pages = Math.max(1, Math.ceil(total / input.limit));
    const page = Math.min(input.page, pages);
    const entries = await prisma.walletLedgerEntry.findMany({
        where: { walletId },
        orderBy: [{ createdAt: "desc" }, { id: "desc" }],
        skip: (page - 1) * input.limit,
        take: input.limit,
        select: {
            id: true,
            source: true,
            deltaCoin: true,
            balanceBefore: true,
            balanceAfter: true,
            referenceType: true,
            referenceId: true,
            createdAt: true,
            actorUser: {
                select: {
                    id: true,
                    username: true,
                },
            },
            adjustment: {
                select: {
                    reason: true,
                },
            },
        },
    });
    return {
        userId: user.id,
        username: user.username,
        coinBalance,
        reconciliationStatus:
            latestEntry === null
                ? "not_initialized"
                : latestEntry.balanceAfter === coinBalance
                  ? "reconciled"
                  : "mismatch",
        latestLedgerBalance: latestEntry?.balanceAfter ?? null,
        entries: entries.map((entry) => ({
            id: entry.id,
            source: entry.source,
            deltaCoin: entry.deltaCoin,
            balanceBefore: entry.balanceBefore,
            balanceAfter: entry.balanceAfter,
            referenceType: entry.referenceType,
            referenceId: entry.referenceId,
            createdAt: entry.createdAt.toISOString(),
            actor: entry.actorUser,
            adjustmentReason: entry.adjustment?.reason ?? null,
        })),
        page,
        pages,
        total,
    };
}
