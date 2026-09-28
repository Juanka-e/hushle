import { NextRequest, NextResponse } from "next/server";
import { requireAdminSession } from "@/lib/admin/require-admin";
import {
    adminMatchHistoryParamsSchema,
    adminMatchHistoryQuerySchema,
} from "@/lib/admin-match-history/schema";
import { getAdminUserMatchHistory } from "@/lib/admin-match-history/service";
import {
    buildRateLimitHeaders,
    consumeRequestRateLimit,
    getRequestIp,
} from "@/lib/security/request-rate-limit";

export const dynamic = "force-dynamic";

export async function GET(
    request: NextRequest,
    context: { params: Promise<{ id: string }> }
) {
    const adminSession = await requireAdminSession();
    if (adminSession instanceof NextResponse) return adminSession;

    const rateLimit = consumeRequestRateLimit({
        bucket: "admin-match-history-read",
        key: `admin:${adminSession.id}:${getRequestIp(request)}`,
        windowMs: 60_000,
        maxRequests: 90,
    });
    if (!rateLimit.allowed) {
        return NextResponse.json(
            {
                error: "Çok fazla maç geçmişi isteği. Lütfen biraz bekleyin.",
            },
            {
                status: 429,
                headers: buildRateLimitHeaders(rateLimit),
            }
        );
    }

    const params = adminMatchHistoryParamsSchema.safeParse(
        await context.params
    );
    const { searchParams } = new URL(request.url);
    const query = adminMatchHistoryQuerySchema.safeParse({
        page: searchParams.get("page") ?? undefined,
        limit: searchParams.get("limit") ?? undefined,
    });
    if (!params.success || !query.success) {
        return NextResponse.json(
            { error: "Geçersiz maç geçmişi isteği." },
            { status: 422 }
        );
    }

    const result = await getAdminUserMatchHistory(
        params.data.id,
        query.data
    );
    if (!result) {
        return NextResponse.json(
            { error: "Kullanıcı bulunamadı." },
            { status: 404 }
        );
    }

    return NextResponse.json(result, {
        headers: buildRateLimitHeaders(rateLimit),
    });
}
