import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { requireAdminSession } from "@/lib/admin/require-admin";
import { getAdminUserInventoryView } from "@/lib/admin-inventory-operations/service";
import {
    buildRateLimitHeaders,
    consumeRequestRateLimit,
    getRequestIp,
} from "@/lib/security/request-rate-limit";

export const dynamic = "force-dynamic";

const routeParamsSchema = z.object({
    id: z.coerce.number().int().min(1),
});

export async function GET(
    request: NextRequest,
    context: { params: Promise<{ id: string }> }
) {
    const adminSession = await requireAdminSession();
    if (adminSession instanceof NextResponse) {
        return adminSession;
    }

    const rateLimit = consumeRequestRateLimit({
        bucket: "admin-inventory-read",
        key: `admin:${adminSession.id}:${getRequestIp(request)}`,
        windowMs: 60_000,
        maxRequests: 120,
    });
    if (!rateLimit.allowed) {
        return NextResponse.json(
            { error: "Çok fazla envanter isteği. Lütfen biraz bekleyin." },
            { status: 429, headers: buildRateLimitHeaders(rateLimit) }
        );
    }

    const parsedParams = routeParamsSchema.safeParse(await context.params);
    if (!parsedParams.success) {
        return NextResponse.json({ error: "Geçersiz kullanıcı." }, { status: 422 });
    }

    const inventory = await getAdminUserInventoryView(parsedParams.data.id);
    if (!inventory) {
        return NextResponse.json({ error: "Kullanıcı bulunamadı." }, { status: 404 });
    }

    return NextResponse.json(inventory);
}
