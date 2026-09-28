import { NextResponse } from "next/server";
import { z } from "zod";
import { getSessionUser } from "@/lib/session";
import { previewCouponForTarget } from "@/lib/economy";
import {
    buildRateLimitHeaders,
    consumeRequestRateLimit,
    getRequestIp,
} from "@/lib/security/request-rate-limit";
import { getSystemSettings } from "@/lib/system-settings/service";
import {
    getFeatureDisabledMessage,
    isStoreAvailable,
} from "@/lib/system-settings/policies";

const previewSchema = z.object({
    targetKind: z.enum(["shop_item", "bundle"]),
    targetId: z.number().int().positive(),
    couponCode: z.string().trim().min(1).max(80),
});

export async function POST(req: Request) {
    const sessionUser = await getSessionUser();
    if (!sessionUser) {
        return NextResponse.json({ error: "Giris gerekli." }, { status: 401 });
    }

    const settings = await getSystemSettings();
    if (!isStoreAvailable(settings)) {
        return NextResponse.json(
            { error: getFeatureDisabledMessage("store") },
            { status: 409 }
        );
    }

    try {
        const rateLimit = consumeRequestRateLimit({
            bucket: "store-coupon-preview",
            key: `user:${sessionUser.id}:${getRequestIp(req)}`,
            windowMs: 5 * 60_000,
            maxRequests: 40,
        });
        if (!rateLimit.allowed) {
            return NextResponse.json(
                { error: "Cok fazla kupon denemesi yaptin. Biraz bekleyip tekrar dene." },
                { status: 429, headers: buildRateLimitHeaders(rateLimit) }
            );
        }

        const body = await req.json();
        const { targetKind, targetId, couponCode } = previewSchema.parse(body);
        const result = await previewCouponForTarget(sessionUser.id, targetKind, targetId, couponCode, settings);

        return NextResponse.json(result, { status: result.valid ? 200 : 409 });
    } catch (error) {
        if (error instanceof z.ZodError) {
            return NextResponse.json({ error: error.issues[0]?.message || "Gecersiz veri." }, { status: 422 });
        }

        return NextResponse.json({ error: "Kupon dogrulanamadi." }, { status: 500 });
    }
}
