import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { requireAdminSession } from "@/lib/admin/require-admin";
import { deactivateCoinGrantCode } from "@/lib/coin-grants/service";
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

export async function DELETE(request: NextRequest, context: { params: Promise<{ id: string }> }) {
    const adminSession = await requireAdminSession();
    if (adminSession instanceof NextResponse) {
        return adminSession;
    }

    const paramsResult = routeParamsSchema.safeParse(await context.params);
    if (!paramsResult.success) {
        return NextResponse.json({ error: "Geçersiz kod." }, { status: 422 });
    }

    const rateLimit = consumeRequestRateLimit({
        bucket: "admin-coin-grant-code-delete",
        key: `admin:${adminSession.id}:${getRequestIp(request)}`,
        windowMs: 60_000,
        maxRequests: 30,
    });
    if (!rateLimit.allowed) {
        return NextResponse.json(
            { error: "Çok fazla kod pasife alma denemesi. Lütfen biraz bekleyin." },
            { status: 429, headers: buildRateLimitHeaders(rateLimit) }
        );
    }

    const outcome = await deactivateCoinGrantCode(paramsResult.data.id);
    if (!outcome) {
        return NextResponse.json({ error: "Kod bulunamadı." }, { status: 404 });
    }
    if (outcome === "archived") {
        return NextResponse.json({ error: "Arşivli kod pasife alınamaz." }, { status: 409 });
    }

    await writeAuditLog({
        actor: adminSession,
        action: "admin.coin_grant_code.deactivate",
        resourceType: "coin_grant_code",
        resourceId: paramsResult.data.id,
        summary: `${outcome} coin grant code ${paramsResult.data.id}`,
        metadata: {
            outcome,
        },
        request,
    });

    return NextResponse.json({ ok: true, outcome });
}
