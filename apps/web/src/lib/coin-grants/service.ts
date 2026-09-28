import { randomBytes } from "node:crypto";
import { Prisma } from "@hushle/platform-db";
import { prisma } from "@/lib/prisma";
import { createUserNotificationWithClient } from "@/lib/notifications/service";
import { invalidateNotificationUnreadCountCache } from "@/lib/cache/application-cache";
import { applyWalletLedgerMutation } from "@/lib/wallet-ledger/service";
import type {
    CoinGrantCampaignWriteInput,
    CoinGrantCodeBatchCreateInput,
    CoinGrantRedeemInput,
} from "@/lib/coin-grants/schema";
import type {
    CoinGrantCampaignView,
    CoinGrantClaimView,
    CoinGrantCodeView,
    CoinGrantRedeemResult,
} from "@/types/coin-grants";

const COIN_GRANT_CODE_ALPHABET = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";

type RedeemFailureCode = Exclude<CoinGrantRedeemResult, { ok: true }>['code'];
type CoinGrantWorkflowErrorCode = "campaign_archived" | "campaign_inactive" | "campaign_not_found";

class CoinGrantRedeemFailure extends Error {
    constructor(public readonly code: RedeemFailureCode) {
        super(code);
    }
}

export class CoinGrantWorkflowError extends Error {
    constructor(public readonly code: CoinGrantWorkflowErrorCode) {
        super(code);
    }
}

function isPrismaKnownError(
    error: unknown,
    code?: string
): error is { code: string } {
    return (
        typeof error === "object" &&
        error !== null &&
        "code" in error &&
        typeof (error as { code?: unknown }).code === "string" &&
        (code ? (error as { code: string }).code === code : true)
    );
}

function toIsoString(value: Date | null): string | null {
    return value ? value.toISOString() : null;
}

function mapCoinGrantCode(code: {
    id: number;
    campaignId: number;
    code: string;
    label: string | null;
    maxClaims: number | null;
    claimCount: number;
    expiresAt: Date | null;
    isActive: boolean;
    archivedAt: Date | null;
    createdAt: Date;
}): CoinGrantCodeView {
    return {
        id: code.id,
        campaignId: code.campaignId,
        code: code.code,
        label: code.label,
        maxClaims: code.maxClaims,
        claimCount: code.claimCount,
        expiresAt: toIsoString(code.expiresAt),
        isActive: code.isActive,
        archivedAt: toIsoString(code.archivedAt),
        createdAt: code.createdAt.toISOString(),
    };
}

function mapCoinGrantCampaign(campaign: {
    id: number;
    code: string;
    name: string;
    description: string | null;
    coinAmount: number;
    totalBudgetCoin: number | null;
    totalGrantedCoin: number;
    totalClaimLimit: number | null;
    totalClaimCount: number;
    perUserClaimLimit: number;
    startsAt: Date | null;
    endsAt: Date | null;
    isActive: boolean;
    archivedAt: Date | null;
    createdAt: Date;
    updatedAt: Date;
    codes: Array<{
        id: number;
        campaignId: number;
        code: string;
        label: string | null;
        maxClaims: number | null;
        claimCount: number;
        expiresAt: Date | null;
        isActive: boolean;
        archivedAt: Date | null;
        createdAt: Date;
    }>;
}): CoinGrantCampaignView {
    return {
        id: campaign.id,
        code: campaign.code,
        name: campaign.name,
        description: campaign.description,
        coinAmount: campaign.coinAmount,
        totalBudgetCoin: campaign.totalBudgetCoin,
        totalGrantedCoin: campaign.totalGrantedCoin,
        totalClaimLimit: campaign.totalClaimLimit,
        totalClaimCount: campaign.totalClaimCount,
        perUserClaimLimit: campaign.perUserClaimLimit,
        startsAt: toIsoString(campaign.startsAt),
        endsAt: toIsoString(campaign.endsAt),
        isActive: campaign.isActive,
        archivedAt: toIsoString(campaign.archivedAt),
        createdAt: campaign.createdAt.toISOString(),
        updatedAt: campaign.updatedAt.toISOString(),
        codes: campaign.codes.map(mapCoinGrantCode),
    };
}

function mapCoinGrantClaim(claim: {
    id: number;
    campaignId: number;
    codeId: number;
    userId: number;
    status: "completed";
    coinAmount: number;
    createdAt: Date;
}): CoinGrantClaimView {
    return {
        id: claim.id,
        campaignId: claim.campaignId,
        codeId: claim.codeId,
        userId: claim.userId,
        status: claim.status,
        coinAmount: claim.coinAmount,
        createdAt: claim.createdAt.toISOString(),
    };
}

export function normalizeCoinGrantCode(code: string): string {
    return code.trim().toUpperCase();
}

function randomCodeSuffix(length: number): string {
    const bytes = randomBytes(length);
    let suffix = "";
    for (let index = 0; index < bytes.length; index += 1) {
        suffix += COIN_GRANT_CODE_ALPHABET[bytes[index] % COIN_GRANT_CODE_ALPHABET.length];
    }
    return suffix;
}

export function buildGeneratedCoinGrantCodes(prefix: string, quantity: number): string[] {
    const normalizedPrefix = normalizeCoinGrantCode(prefix);
    const generated = new Set<string>();

    while (generated.size < quantity) {
        generated.add(`${normalizedPrefix}-${randomCodeSuffix(6)}`);
    }

    return [...generated];
}

function parseOptionalDate(value: string | null | undefined): Date | null {
    return value ? new Date(value) : null;
}

function buildCampaignAvailabilityError(campaign: {
    isActive: boolean;
    archivedAt?: Date | null;
    startsAt: Date | null;
    endsAt: Date | null;
}, now: Date): RedeemFailureCode | null {
    if (campaign.archivedAt) {
        return "inactive";
    }
    if (!campaign.isActive) {
        return "inactive";
    }
    if (campaign.startsAt && campaign.startsAt.getTime() > now.getTime()) {
        return "campaign_not_started";
    }
    if (campaign.endsAt && campaign.endsAt.getTime() < now.getTime()) {
        return "campaign_ended";
    }
    return null;
}

function buildCodeAvailabilityError(code: {
    isActive: boolean;
    archivedAt?: Date | null;
    expiresAt: Date | null;
}, now: Date): RedeemFailureCode | null {
    if (code.archivedAt) {
        return "inactive";
    }
    if (!code.isActive) {
        return "inactive";
    }
    if (code.expiresAt && code.expiresAt.getTime() < now.getTime()) {
        return "expired";
    }
    return null;
}

async function reserveCampaignBudget(
    tx: Prisma.TransactionClient,
    campaign: {
        id: number;
        coinAmount: number;
        totalBudgetCoin: number | null;
        totalGrantedCoin: number;
        totalClaimLimit: number | null;
        totalClaimCount: number;
    }
): Promise<void> {
    if (campaign.totalBudgetCoin !== null && campaign.totalGrantedCoin + campaign.coinAmount > campaign.totalBudgetCoin) {
        throw new CoinGrantRedeemFailure("campaign_budget_exhausted");
    }

    if (campaign.totalClaimLimit !== null && campaign.totalClaimCount >= campaign.totalClaimLimit) {
        throw new CoinGrantRedeemFailure("campaign_claim_limit_reached");
    }

    const result = await tx.coinGrantCampaign.updateMany({
        where: {
            id: campaign.id,
            ...(campaign.totalBudgetCoin !== null
                ? {
                    totalGrantedCoin: {
                        lte: campaign.totalBudgetCoin - campaign.coinAmount,
                    },
                }
                : {}),
            ...(campaign.totalClaimLimit !== null
                ? {
                    totalClaimCount: {
                        lt: campaign.totalClaimLimit,
                    },
                }
                : {}),
        },
        data: {
            totalGrantedCoin: { increment: campaign.coinAmount },
            totalClaimCount: { increment: 1 },
        },
    });

    if (result.count !== 1) {
        throw new CoinGrantRedeemFailure(
            campaign.totalBudgetCoin !== null && campaign.totalGrantedCoin + campaign.coinAmount > campaign.totalBudgetCoin
                ? "campaign_budget_exhausted"
                : "campaign_claim_limit_reached"
        );
    }
}

async function reserveCodeUsage(
    tx: Prisma.TransactionClient,
    code: {
        id: number;
        maxClaims: number | null;
        claimCount: number;
    }
): Promise<void> {
    if (code.maxClaims !== null && code.claimCount >= code.maxClaims) {
        throw new CoinGrantRedeemFailure("code_claim_limit_reached");
    }

    const result = await tx.coinGrantCode.updateMany({
        where: {
            id: code.id,
            ...(code.maxClaims !== null
                ? {
                    claimCount: {
                        lt: code.maxClaims,
                    },
                }
                : {}),
        },
        data: {
            claimCount: { increment: 1 },
        },
    });

    if (result.count !== 1) {
        throw new CoinGrantRedeemFailure("code_claim_limit_reached");
    }
}

async function reserveUserCampaignUsage(input: {
    tx: Prisma.TransactionClient;
    campaignId: number;
    userId: number;
    perUserClaimLimit: number;
    coinAmount: number;
    now: Date;
}): Promise<void> {
    const { tx, campaignId, userId, perUserClaimLimit, coinAmount, now } = input;

    try {
        await tx.coinGrantCampaignUser.create({
            data: {
                campaignId,
                userId,
                claimCount: 1,
                grantedCoin: coinAmount,
                lastClaimAt: now,
            },
        });
        return;
    } catch (error) {
        if (!isPrismaKnownError(error, "P2002")) {
            throw error;
        }
    }

    const result = await tx.coinGrantCampaignUser.updateMany({
        where: {
            campaignId,
            userId,
            claimCount: {
                lt: perUserClaimLimit,
            },
        },
        data: {
            claimCount: { increment: 1 },
            grantedCoin: { increment: coinAmount },
            lastClaimAt: now,
        },
    });

    if (result.count !== 1) {
        throw new CoinGrantRedeemFailure("user_claim_limit_reached");
    }
}

export async function listCoinGrantCampaigns(): Promise<CoinGrantCampaignView[]> {
    const campaigns = await prisma.coinGrantCampaign.findMany({
        orderBy: [{ createdAt: "desc" }, { id: "desc" }],
        include: {
            codes: {
                orderBy: [{ createdAt: "desc" }, { id: "desc" }],
            },
        },
    });

    return campaigns.map(mapCoinGrantCampaign);
}

export async function createCoinGrantCampaign(input: CoinGrantCampaignWriteInput): Promise<CoinGrantCampaignView> {
    const campaign = await prisma.coinGrantCampaign.create({
        data: {
            code: normalizeCoinGrantCode(input.code),
            name: input.name,
            description: input.description?.trim() || null,
            coinAmount: input.coinAmount,
            totalBudgetCoin: input.totalBudgetCoin ?? null,
            totalClaimLimit: input.totalClaimLimit ?? null,
            perUserClaimLimit: input.perUserClaimLimit,
            startsAt: parseOptionalDate(input.startsAt),
            endsAt: parseOptionalDate(input.endsAt),
            isActive: input.isActive,
            archivedAt: null,
        },
        include: {
            codes: true,
        },
    });

    return mapCoinGrantCampaign(campaign);
}

export async function updateCoinGrantCampaign(id: number, input: CoinGrantCampaignWriteInput): Promise<CoinGrantCampaignView | null> {
    const existing = await prisma.coinGrantCampaign.findUnique({
        where: { id },
        select: { id: true, archivedAt: true },
    });
    if (!existing) {
        return null;
    }
    if (existing.archivedAt) {
        throw new CoinGrantWorkflowError("campaign_archived");
    }

    const campaign = await prisma.coinGrantCampaign.update({
        where: { id },
        data: {
            code: normalizeCoinGrantCode(input.code),
            name: input.name,
            description: input.description?.trim() || null,
            coinAmount: input.coinAmount,
            totalBudgetCoin: input.totalBudgetCoin ?? null,
            totalClaimLimit: input.totalClaimLimit ?? null,
            perUserClaimLimit: input.perUserClaimLimit,
            startsAt: parseOptionalDate(input.startsAt),
            endsAt: parseOptionalDate(input.endsAt),
            isActive: input.isActive,
        },
        include: {
            codes: {
                orderBy: [{ createdAt: "desc" }, { id: "desc" }],
            },
        },
    });

    return mapCoinGrantCampaign(campaign);
}

export async function deactivateCoinGrantCampaign(id: number): Promise<"deactivated" | "archived" | null> {
    const existing = await prisma.coinGrantCampaign.findUnique({
        where: { id },
        select: {
            id: true,
            isActive: true,
            archivedAt: true,
        },
    });

    if (!existing) {
        return null;
    }

    if (existing.archivedAt) {
        return "archived";
    }

    if (!existing.isActive) {
        return "deactivated";
    }

    await prisma.coinGrantCampaign.update({
        where: { id },
        data: { isActive: false },
    });

    return "deactivated";
}

export async function createCoinGrantCodes(input: CoinGrantCodeBatchCreateInput): Promise<CoinGrantCodeView[]> {
    const campaign = await prisma.coinGrantCampaign.findUnique({
        where: { id: input.campaignId },
        select: {
            id: true,
            isActive: true,
            archivedAt: true,
        },
    });

    if (!campaign) {
        throw new CoinGrantWorkflowError("campaign_not_found");
    }
    if (campaign.archivedAt) {
        throw new CoinGrantWorkflowError("campaign_archived");
    }
    if (!campaign.isActive) {
        throw new CoinGrantWorkflowError("campaign_inactive");
    }

    const quantity = input.quantity;
    const manualCode = input.manualCode ? normalizeCoinGrantCode(input.manualCode) : null;
    const prefix = input.prefix ? normalizeCoinGrantCode(input.prefix) : null;

    let codesToCreate: string[];
    if (quantity === 1 && manualCode) {
        codesToCreate = [manualCode];
    } else {
        if (!prefix) {
            return [];
        }

        const generated = buildGeneratedCoinGrantCodes(prefix, quantity * 2);
        const existingCodes = await prisma.coinGrantCode.findMany({
            where: {
                code: {
                    in: generated,
                },
            },
            select: { code: true },
        });
        const existingSet = new Set(existingCodes.map((entry) => entry.code));
        codesToCreate = generated.filter((entry) => !existingSet.has(entry)).slice(0, quantity);

        while (codesToCreate.length < quantity) {
            const fallback = buildGeneratedCoinGrantCodes(prefix, quantity - codesToCreate.length);
            const fallbackExisting = await prisma.coinGrantCode.findMany({
                where: {
                    code: {
                        in: fallback,
                    },
                },
                select: { code: true },
            });
            const fallbackExistingSet = new Set(fallbackExisting.map((entry) => entry.code));
            const filtered = fallback.filter((entry) => !fallbackExistingSet.has(entry));
            for (const entry of filtered) {
                if (codesToCreate.length < quantity) {
                    codesToCreate.push(entry);
                }
            }
        }
    }

    await prisma.coinGrantCode.createMany({
        data: codesToCreate.map((code) => ({
            campaignId: input.campaignId,
            code,
            label: input.label?.trim() || null,
            maxClaims: input.maxClaims ?? null,
            expiresAt: parseOptionalDate(input.expiresAt),
            isActive: input.isActive,
            archivedAt: null,
        })),
    });

    const createdCodes = await prisma.coinGrantCode.findMany({
        where: {
            code: {
                in: codesToCreate,
            },
        },
        orderBy: [{ createdAt: "desc" }, { id: "desc" }],
    });

    return createdCodes.map(mapCoinGrantCode);
}

export async function deactivateCoinGrantCode(id: number): Promise<"deactivated" | "archived" | null> {
    const existing = await prisma.coinGrantCode.findUnique({
        where: { id },
        select: {
            id: true,
            isActive: true,
            archivedAt: true,
        },
    });

    if (!existing) {
        return null;
    }

    if (existing.archivedAt) {
        return "archived";
    }

    if (!existing.isActive) {
        return "deactivated";
    }

    await prisma.coinGrantCode.update({
        where: { id },
        data: { isActive: false },
    });

    return "deactivated";
}

export async function archiveCoinGrantCampaign(id: number): Promise<"archived" | null | "conflict"> {
    const existing = await prisma.coinGrantCampaign.findUnique({
        where: { id },
        select: {
            id: true,
            isActive: true,
            archivedAt: true,
        },
    });

    if (!existing) {
        return null;
    }

    if (existing.archivedAt) {
        return "archived";
    }

    if (existing.isActive) {
        return "conflict";
    }

    await prisma.coinGrantCampaign.update({
        where: { id },
        data: {
            archivedAt: new Date(),
        },
    });

    return "archived";
}

export async function archiveCoinGrantCode(id: number): Promise<"archived" | null | "conflict"> {
    const existing = await prisma.coinGrantCode.findUnique({
        where: { id },
        select: {
            id: true,
            isActive: true,
            archivedAt: true,
        },
    });

    if (!existing) {
        return null;
    }

    if (existing.archivedAt) {
        return "archived";
    }

    if (existing.isActive) {
        return "conflict";
    }

    await prisma.coinGrantCode.update({
        where: { id },
        data: {
            archivedAt: new Date(),
        },
    });

    return "archived";
}

export async function restoreCoinGrantCampaign(id: number): Promise<"restored" | null> {
    const existing = await prisma.coinGrantCampaign.findUnique({
        where: { id },
        select: {
            id: true,
            archivedAt: true,
        },
    });

    if (!existing) {
        return null;
    }

    if (!existing.archivedAt) {
        return "restored";
    }

    await prisma.coinGrantCampaign.update({
        where: { id },
        data: {
            archivedAt: null,
            isActive: false,
        },
    });

    return "restored";
}

export async function restoreCoinGrantCode(id: number): Promise<"restored" | null> {
    const existing = await prisma.coinGrantCode.findUnique({
        where: { id },
        select: {
            id: true,
            archivedAt: true,
        },
    });

    if (!existing) {
        return null;
    }

    if (!existing.archivedAt) {
        return "restored";
    }

    await prisma.coinGrantCode.update({
        where: { id },
        data: {
            archivedAt: null,
            isActive: false,
        },
    });

    return "restored";
}

export async function redeemCoinGrantCode(input: {
    userId: number;
    redeem: CoinGrantRedeemInput;
}): Promise<CoinGrantRedeemResult> {
    const normalizedCode = normalizeCoinGrantCode(input.redeem.code);
    const now = new Date();

    try {
        const result = await prisma.$transaction(async (tx) => {
            await tx.wallet.upsert({
                where: { userId: input.userId },
                update: {},
                create: { userId: input.userId, coinBalance: 0 },
            });

            const codeRecord = await tx.coinGrantCode.findUnique({
                where: { code: normalizedCode },
                include: {
                    campaign: true,
                },
            });

            if (!codeRecord) {
                throw new CoinGrantRedeemFailure("not_found");
            }

            const codeAvailabilityError = buildCodeAvailabilityError(codeRecord, now);
            if (codeAvailabilityError) {
                throw new CoinGrantRedeemFailure(codeAvailabilityError);
            }

            const campaignAvailabilityError = buildCampaignAvailabilityError(codeRecord.campaign, now);
            if (campaignAvailabilityError) {
                throw new CoinGrantRedeemFailure(campaignAvailabilityError);
            }

            await reserveCampaignBudget(tx, codeRecord.campaign);
            await reserveCodeUsage(tx, codeRecord);
            await reserveUserCampaignUsage({
                tx,
                campaignId: codeRecord.campaignId,
                userId: input.userId,
                perUserClaimLimit: codeRecord.campaign.perUserClaimLimit,
                coinAmount: codeRecord.campaign.coinAmount,
                now,
            });

            const claim = await tx.coinGrantClaim.create({
                data: {
                    campaignId: codeRecord.campaignId,
                    codeId: codeRecord.id,
                    userId: input.userId,
                    status: "completed",
                    coinAmount: codeRecord.campaign.coinAmount,
                },
            });
            const walletMutation = await applyWalletLedgerMutation(tx, {
                userId: input.userId,
                source: "coin_grant",
                deltaCoin: codeRecord.campaign.coinAmount,
                idempotencyKey: `coin_grant_claim:${claim.id}:credit`,
                referenceType: "coin_grant_claim",
                referenceId: claim.id,
                metadata: {
                    campaignId: codeRecord.campaign.id,
                    codeId: codeRecord.id,
                },
            });

            await createUserNotificationWithClient(tx, {
                userId: input.userId,
                type: "economy",
                title: "Coin kodu kullanıldı",
                body: `${codeRecord.campaign.coinAmount} coin hesabına eklendi.`,
                resourceType: "coin_grant_claim",
                resourceId: claim.id,
                actionLabel: "Mağazayı Aç",
                actionHref: "/dashboard?tab=shop",
                metadata: {
                    kind: "coin_grant",
                    code: codeRecord.code,
                    campaignCode: codeRecord.campaign.code,
                    coinAmount: codeRecord.campaign.coinAmount,
                },
            }, { deferCacheInvalidation: true });

            return {
                ok: true,
                campaign: {
                    id: codeRecord.campaign.id,
                    code: codeRecord.campaign.code,
                    name: codeRecord.campaign.name,
                },
                code: {
                    id: codeRecord.id,
                    code: codeRecord.code,
                    label: codeRecord.label,
                },
                coinAmount: codeRecord.campaign.coinAmount,
                coinBalance: walletMutation.balanceAfter,
                claim: mapCoinGrantClaim(claim),
            } satisfies CoinGrantRedeemResult;
        }, { isolationLevel: Prisma.TransactionIsolationLevel.Serializable });
        await invalidateNotificationUnreadCountCache(input.userId);
        return result;
    } catch (error) {
        if (error instanceof CoinGrantRedeemFailure) {
            return { ok: false, code: error.code };
        }
        throw error;
    }
}
