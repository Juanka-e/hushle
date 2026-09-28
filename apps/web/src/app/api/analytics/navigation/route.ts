import { NextResponse } from "next/server";
import { z } from "zod";
import { recordProductAnalyticsEvent } from "@/lib/analytics/product-events";
import {
    buildRateLimitHeaders,
    consumeDistributedRequestRateLimit,
    getRequestIp,
} from "@/lib/security/request-rate-limit";

const navigationSchema = z.object({
    screen: z.enum([
        "home",
        "dashboard",
        "store",
        "inventory",
        "profile",
        "room_lobby",
        "room_game",
    ]),
}).strict();

export async function POST(request: Request) {
    const rateLimit = await consumeDistributedRequestRateLimit({
        bucket: "analytics-navigation",
        key: `ip:${getRequestIp(request)}`,
        windowMs: 60_000,
        maxRequests: 30,
    });
    if (!rateLimit.allowed) {
        return NextResponse.json(
            { accepted: false },
            { status: 429, headers: buildRateLimitHeaders(rateLimit) }
        );
    }

    try {
        const input = navigationSchema.parse(await request.json());
        await recordProductAnalyticsEvent({
            name: "navigation.screen_viewed",
            version: 1,
            trust: "client_observed",
            occurredAt: new Date(),
            screen: input.screen,
        });
        return NextResponse.json(
            { accepted: true },
            { status: 202, headers: buildRateLimitHeaders(rateLimit) }
        );
    } catch {
        return NextResponse.json(
            { accepted: false },
            { status: 422, headers: buildRateLimitHeaders(rateLimit) }
        );
    }
}
