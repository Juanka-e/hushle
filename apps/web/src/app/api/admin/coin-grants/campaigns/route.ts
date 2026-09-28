import { NextRequest, NextResponse } from "next/server";
import { requireAdminSession } from "@/lib/admin/require-admin";
import { coinGrantCampaignWriteSchema } from "@/lib/coin-grants/schema";
import { createCoinGrantCampaign, listCoinGrantCampaigns } from "@/lib/coin-grants/service";
import { writeAuditLog } from "@/lib/security/audit-log";
import {
    buildRateLimitHeaders,
    consumeRequestRateLimit,
    getRequestIp,
} from "@/lib/security/request-rate-limit";
import { z } from "zod";

export const dynamic = "force-dynamic";

export async function GET() {
    const adminSession = await requireAdminSession();
    if (adminSession instanceof NextResponse) {
        return adminSession;
    }

    const campaigns = await listCoinGrantCampaigns();
    return NextResponse.json(campaigns);
}

export async function POST(request: NextRequest) {
    const adminSession = await requireAdminSession();
    if (adminSession instanceof NextResponse) {
        return adminSession;
    }

    try {
        const rateLimit = consumeRequestRateLimit({
            bucket: "admin-coin-grant-campaign-create",
            key: `admin:${adminSession.id}:${getRequestIp(request)}`,
            windowMs: 60_000,
            maxRequests: 20,
        });
        if (!rateLimit.allowed) {
            return NextResponse.json(
                { error: "Çok fazla kampanya işlemi denemesi. Lütfen biraz bekleyin." },
                { status: 429, headers: buildRateLimitHeaders(rateLimit) }
            );
        }

        const body = await request.json();
        const input = coinGrantCampaignWriteSchema.parse(body);
        const campaign = await createCoinGrantCampaign(input);

        await writeAuditLog({
            actor: adminSession,
            action: "admin.coin_grant_campaign.create",
            resourceType: "coin_grant_campaign",
            resourceId: campaign.id,
            summary: `created ${campaign.code}`,
            metadata: {
                campaignCode: campaign.code,
                coinAmount: campaign.coinAmount,
                totalBudgetCoin: campaign.totalBudgetCoin,
                totalClaimLimit: campaign.totalClaimLimit,
                perUserClaimLimit: campaign.perUserClaimLimit,
            },
            request,
        });

        return NextResponse.json(campaign, { status: 201 });
    } catch (error) {
        if (typeof error === "object" && error !== null && "code" in error && (error as { code?: string }).code === "P2002") {
            return NextResponse.json({ error: "Aynı kod ile bir kampanya zaten var." }, { status: 409 });
        }

        if (error instanceof z.ZodError) {
            return NextResponse.json({ error: error.issues[0]?.message || "Geçersiz kampanya verisi." }, { status: 422 });
        }

        console.error("Failed to create coin grant campaign:", error);
        return NextResponse.json({ error: "Kampanya oluşturulamadı." }, { status: 500 });
    }
}
