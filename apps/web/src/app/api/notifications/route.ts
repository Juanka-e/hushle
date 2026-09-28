import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { getSessionUser } from "@/lib/session";
import { notificationListQuerySchema } from "@/lib/notifications/schema";
import { listNotificationsForUser } from "@/lib/notifications/service";
import {
    buildRateLimitHeaders,
    consumeRequestRateLimit,
    getRequestIp,
} from "@/lib/security/request-rate-limit";

export const dynamic = "force-dynamic";

export async function GET(request: NextRequest) {
    const sessionUser = await getSessionUser();
    if (!sessionUser) {
        return NextResponse.json({ error: "Giris gerekli." }, { status: 401 });
    }

    const rateLimit = consumeRequestRateLimit({
        bucket: "notifications-read",
        key: `user:${sessionUser.id}:${getRequestIp(request)}`,
        windowMs: 60_000,
        maxRequests: 90,
    });
    if (!rateLimit.allowed) {
        return NextResponse.json(
            { error: "Cok fazla bildirim istegi gonderildi. Lutfen biraz bekleyin." },
            { status: 429, headers: buildRateLimitHeaders(rateLimit) }
        );
    }

    try {
        const query = notificationListQuerySchema.parse({
            limit: request.nextUrl.searchParams.get("limit") ?? undefined,
            filter: request.nextUrl.searchParams.get("filter") ?? undefined,
        });

        const result = await listNotificationsForUser(sessionUser.id, query);
        return NextResponse.json(result, { headers: buildRateLimitHeaders(rateLimit) });
    } catch (error) {
        if (error instanceof z.ZodError) {
            return NextResponse.json(
                { error: error.issues[0]?.message || "Gecersiz bildirim istegi." },
                { status: 422 }
            );
        }

        console.error("Failed to load notifications:", error);
        return NextResponse.json({ error: "Bildirimler yuklenemedi." }, { status: 500 });
    }
}
