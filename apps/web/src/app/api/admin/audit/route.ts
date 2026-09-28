import { NextRequest, NextResponse } from "next/server";
import { requireAdminSession } from "@/lib/admin/require-admin";
import { adminAuditListQuerySchema } from "@/lib/admin-audit/schema";
import { getAdminAuditLogs } from "@/lib/admin-audit/service";
import {
    buildRateLimitHeaders,
    consumeRequestRateLimit,
    getRequestIp,
} from "@/lib/security/request-rate-limit";

export const dynamic = "force-dynamic";

export async function GET(request: NextRequest) {
    const adminSession = await requireAdminSession();
    if (adminSession instanceof NextResponse) {
        return adminSession;
    }

    const rateLimit = consumeRequestRateLimit({
        bucket: "admin-audit-read",
        key: `admin:${adminSession.id}:${getRequestIp(request)}`,
        windowMs: 60_000,
        maxRequests: 90,
    });
    if (!rateLimit.allowed) {
        return NextResponse.json(
            { error: "Cok fazla audit istegi. Lutfen biraz bekleyin." },
            { status: 429, headers: buildRateLimitHeaders(rateLimit) }
        );
    }

    const { searchParams } = new URL(request.url);
    const parsedQuery = adminAuditListQuerySchema.safeParse({
        page: searchParams.get("page") ?? undefined,
        limit: searchParams.get("limit") ?? undefined,
        search: searchParams.get("search") ?? undefined,
        action: searchParams.get("action") ?? undefined,
        resourceType: searchParams.get("resourceType") ?? undefined,
        actorRole: searchParams.get("actorRole") ?? undefined,
        economyGuard: searchParams.get("economyGuard") ?? undefined,
        source: searchParams.get("source") ?? undefined,
    });

    if (!parsedQuery.success) {
        return NextResponse.json({ error: "Gecersiz audit filtresi." }, { status: 422 });
    }

    const data = await getAdminAuditLogs(parsedQuery.data);
    return NextResponse.json(data, { headers: buildRateLimitHeaders(rateLimit) });
}
