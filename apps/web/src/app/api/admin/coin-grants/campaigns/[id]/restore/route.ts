import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { requireAdminSession } from "@/lib/admin/require-admin";
import { restoreCoinGrantCampaign } from "@/lib/coin-grants/service";
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

export async function POST(request: NextRequest, context: { params: Promise<{ id: string }> }) {
    const adminSession = await requireAdminSession();
    if (adminSession instanceof NextResponse) {
        return adminSession;
    }

    const paramsResult = routeParamsSchema.safeParse(await context.params);
    if (!paramsResult.success) {
        return NextResponse.json({ error: "Geçersiz kampanya." }, { status: 422 });
    }

    const rateLimit = consumeRequestRateLimit({
        bucket: "admin-coin-grant-campaign-restore",
        key: `admin:${adminSession.id}:${getRequestIp(request)}`,
        windowMs: 60_000,
        maxRequests: 20,
    });
    if (!rateLimit.allowed) {
        return NextResponse.json(
            { error: "Çok fazla kampanya geri alma denemesi. Lütfen biraz bekleyin." },
            { status: 429, headers: buildRateLimitHeaders(rateLimit) }
        );
    }

    const outcome = await restoreCoinGrantCampaign(paramsResult.data.id);
    if (!outcome) {
        return NextResponse.json({ error: "Kampanya bulunamadı." }, { status: 404 });
    }

    await writeAuditLog({
        actor: adminSession,
        action: "admin.coin_grant_campaign.restore",
        resourceType: "coin_grant_campaign",
        resourceId: paramsResult.data.id,
        summary: `restored campaign ${paramsResult.data.id}`,
        request,
    });

    return NextResponse.json({ ok: true, outcome });
}
