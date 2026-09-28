import { NextRequest, NextResponse } from "next/server";
import { getSessionUser } from "@/lib/session";
import { archiveAllNotificationsForUser } from "@/lib/notifications/service";
import {
    buildRateLimitHeaders,
    consumeRequestRateLimit,
    getRequestIp,
} from "@/lib/security/request-rate-limit";

export const dynamic = "force-dynamic";

export async function POST(request: NextRequest) {
    const sessionUser = await getSessionUser();
    if (!sessionUser) {
        return NextResponse.json({ error: "Giris gerekli." }, { status: 401 });
    }

    const rateLimit = consumeRequestRateLimit({
        bucket: "notifications-archive-all",
        key: `user:${sessionUser.id}:${getRequestIp(request)}`,
        windowMs: 60_000,
        maxRequests: 10,
    });
    if (!rateLimit.allowed) {
        return NextResponse.json(
            { error: "Cok fazla istek gonderildi. Lutfen biraz bekleyin." },
            { status: 429, headers: buildRateLimitHeaders(rateLimit) }
        );
    }

    const result = await archiveAllNotificationsForUser(sessionUser.id);
    return NextResponse.json(result, { headers: buildRateLimitHeaders(rateLimit) });
}
