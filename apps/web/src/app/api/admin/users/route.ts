import { NextRequest, NextResponse } from "next/server";
import { requireAdminSession } from "@/lib/admin/require-admin";
import { getAdminUsers } from "@/lib/moderation/service";
import { moderationListQuerySchema } from "@/lib/moderation/schema";
import {
    buildRateLimitHeaders,
    consumeRequestRateLimit,
    getRequestIp,
    shouldTrustProxyHeaders,
} from "@/lib/security/request-rate-limit";

export const dynamic = "force-dynamic";

export async function GET(request: NextRequest) {
    const adminSession = await requireAdminSession();
    if (adminSession instanceof NextResponse) {
        return adminSession;
    }

    const rateLimit = consumeRequestRateLimit({
        bucket: "admin-users-read",
        key: `admin:${adminSession.id}:${getRequestIp(request)}`,
        windowMs: 60_000,
        maxRequests: 120,
    });
    if (!rateLimit.allowed) {
        return NextResponse.json(
            { error: "Cok fazla kullanici listeleme istegi. Lutfen biraz bekleyin." },
            { status: 429, headers: buildRateLimitHeaders(rateLimit) }
        );
    }

    const { searchParams } = new URL(request.url);
    const parsedQuery = moderationListQuerySchema.safeParse({
        page: searchParams.get("page") ?? undefined,
        limit: searchParams.get("limit") ?? undefined,
        search: searchParams.get("search") ?? undefined,
        status: searchParams.get("status") ?? undefined,
    });

    if (!parsedQuery.success) {
        return NextResponse.json({ error: "Gecersiz filtre." }, { status: 422 });
    }

    const data = await getAdminUsers(parsedQuery.data);
    data.trustProxyEnabled = shouldTrustProxyHeaders();
    return NextResponse.json(data, { headers: buildRateLimitHeaders(rateLimit) });
}

