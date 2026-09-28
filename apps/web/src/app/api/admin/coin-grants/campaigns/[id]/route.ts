import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { requireAdminSession } from "@/lib/admin/require-admin";
import { coinGrantCampaignWriteSchema } from "@/lib/coin-grants/schema";
import { CoinGrantWorkflowError, deactivateCoinGrantCampaign, updateCoinGrantCampaign } from "@/lib/coin-grants/service";
import { writeAuditLog } from "@/lib/security/audit-log";
import {
    buildRateLimitHeaders,
    consumeRequestRateLimit,
    getRequestIp,
} from "@/lib/security/request-rate-limit";

export const dynamic = "force-dynamic";

const routeParamsSchema = z.object({
    id: z.coerce.number().int().min(1),
});

export async function PUT(request: NextRequest, context: { params: Promise<{ id: string }> }) {
    const adminSession = await requireAdminSession();
    if (adminSession instanceof NextResponse) {
        return adminSession;
    }

    try {
        const rateLimit = consumeRequestRateLimit({
            bucket: "admin-coin-grant-campaign-update",
            key: `admin:${adminSession.id}:${getRequestIp(request)}`,
            windowMs: 60_000,
            maxRequests: 25,
        });
        if (!rateLimit.allowed) {
            return NextResponse.json(
                { error: "Çok fazla kampanya güncelleme denemesi. Lütfen biraz bekleyin." },
                { status: 429, headers: buildRateLimitHeaders(rateLimit) }
            );
        }

        const params = routeParamsSchema.parse(await context.params);
        const body = await request.json();
        const input = coinGrantCampaignWriteSchema.parse(body);
        const campaign = await updateCoinGrantCampaign(params.id, input);

        if (!campaign) {
            return NextResponse.json({ error: "Kampanya bulunamadı." }, { status: 404 });
        }

        await writeAuditLog({
            actor: adminSession,
            action: "admin.coin_grant_campaign.update",
            resourceType: "coin_grant_campaign",
            resourceId: campaign.id,
            summary: `updated ${campaign.code}`,
            metadata: {
                campaignCode: campaign.code,
                coinAmount: campaign.coinAmount,
                isActive: campaign.isActive,
            },
            request,
        });

        return NextResponse.json(campaign);
    } catch (error) {
        if (error instanceof CoinGrantWorkflowError) {
            const messages: Record<string, string> = {
                campaign_archived: "Arşivli kampanya düzenlenemez.",
                campaign_inactive: "Pasif kampanya bu işlem için uygun değil.",
                campaign_not_found: "Kampanya bulunamadı.",
            };
            const status = error.code === "campaign_not_found" ? 404 : 409;
            return NextResponse.json({ error: messages[error.code] || "Kampanya güncellenemedi." }, { status });
        }

        if (typeof error === "object" && error !== null && "code" in error && (error as { code?: string }).code === "P2002") {
            return NextResponse.json({ error: "Aynı kod ile bir kampanya zaten var." }, { status: 409 });
        }

        if (error instanceof z.ZodError) {
            return NextResponse.json({ error: error.issues[0]?.message || "Geçersiz kampanya verisi." }, { status: 422 });
        }

        console.error("Failed to update coin grant campaign:", error);
        return NextResponse.json({ error: "Kampanya güncellenemedi." }, { status: 500 });
    }
}

export async function DELETE(request: NextRequest, context: { params: Promise<{ id: string }> }) {
    const adminSession = await requireAdminSession();
    if (adminSession instanceof NextResponse) {
        return adminSession;
    }

    const paramsResult = routeParamsSchema.safeParse(await context.params);
    if (!paramsResult.success) {
        return NextResponse.json({ error: "Geçersiz kampanya." }, { status: 422 });
    }

    const rateLimit = consumeRequestRateLimit({
        bucket: "admin-coin-grant-campaign-delete",
        key: `admin:${adminSession.id}:${getRequestIp(request)}`,
        windowMs: 60_000,
        maxRequests: 20,
    });
    if (!rateLimit.allowed) {
        return NextResponse.json(
            { error: "Çok fazla kampanya pasife alma denemesi. Lütfen biraz bekleyin." },
            { status: 429, headers: buildRateLimitHeaders(rateLimit) }
        );
    }

    const outcome = await deactivateCoinGrantCampaign(paramsResult.data.id);
    if (!outcome) {
        return NextResponse.json({ error: "Kampanya bulunamadı." }, { status: 404 });
    }
    if (outcome === "archived") {
        return NextResponse.json({ error: "Arşivli kampanya pasife alınamaz." }, { status: 409 });
    }

    await writeAuditLog({
        actor: adminSession,
        action: "admin.coin_grant_campaign.deactivate",
        resourceType: "coin_grant_campaign",
        resourceId: paramsResult.data.id,
        summary: `${outcome} campaign ${paramsResult.data.id}`,
        metadata: {
            outcome,
        },
        request,
    });

    return NextResponse.json({ ok: true, outcome });
}
