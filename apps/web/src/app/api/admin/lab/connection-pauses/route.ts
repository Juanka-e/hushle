import { NextRequest, NextResponse } from "next/server";
import { requireAdminSession } from "@/lib/admin/require-admin";
import { getConnectionPauseAnalytics } from "@/lib/analytics/connection-pause-analytics";
import {
    buildRateLimitHeaders,
    consumeRequestRateLimit,
} from "@/lib/security/request-rate-limit";

export const dynamic = "force-dynamic";

function parseDays(value: string | null): 7 | 30 | null {
    if (value === null || value === "7") return 7;
    if (value === "30") return 30;
    return null;
}

export async function GET(request: NextRequest) {
    const adminSession = await requireAdminSession();
    if (adminSession instanceof NextResponse) return adminSession;

    const rateLimit = consumeRequestRateLimit({
        bucket: "admin-lab-connection-pauses-read",
        key: `admin:${adminSession.id}`,
        windowMs: 60_000,
        maxRequests: 30,
    });
    if (!rateLimit.allowed) {
        return NextResponse.json(
            { error: "Lab verisi çok sık yenilendi. Lütfen biraz bekleyin." },
            {
                status: 429,
                headers: {
                    ...buildRateLimitHeaders(rateLimit),
                    "Cache-Control": "no-store",
                },
            }
        );
    }

    const days = parseDays(request.nextUrl.searchParams.get("days"));
    if (days === null) {
        return NextResponse.json(
            { error: "Geçersiz gün aralığı. Yalnız 7 veya 30 kullanılabilir." },
            { status: 400, headers: { "Cache-Control": "no-store" } }
        );
    }

    const summary = await getConnectionPauseAnalytics({ days });
    return NextResponse.json(summary, {
        headers: {
            ...buildRateLimitHeaders(rateLimit),
            "Cache-Control": "no-store",
        },
    });
}
