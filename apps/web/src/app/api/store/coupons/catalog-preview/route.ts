import { NextResponse } from "next/server";
import { z } from "zod";
import { getSessionUser } from "@/lib/session";
import { previewCouponForCatalog } from "@/lib/economy";
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
    couponCode: z.string().trim().min(1).max(80),
});

export async function POST(req: Request) {
    const sessionUser = await getSessionUser();
    if (!sessionUser) {
        return NextResponse.json({ error: "Giriş gerekli." }, { status: 401 });
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
            bucket: "store-coupon-catalog-preview",
            key: `user:${sessionUser.id}:${getRequestIp(req)}`,
            windowMs: 5 * 60_000,
            maxRequests: 20,
        });
        if (!rateLimit.allowed) {
            return NextResponse.json(
                { error: "Çok fazla kupon denemesi yaptın. Biraz bekleyip tekrar dene." },
                { status: 429, headers: buildRateLimitHeaders(rateLimit) }
            );
        }

        const body = await req.json();
        const { couponCode } = previewSchema.parse(body);
        const result = await previewCouponForCatalog(sessionUser.id, couponCode, settings);

        return NextResponse.json(result, { status: result.valid ? 200 : 409 });
    } catch (error) {
        if (error instanceof z.ZodError) {
            return NextResponse.json({ error: error.issues[0]?.message || "Geçersiz veri." }, { status: 422 });
        }

        return NextResponse.json({ error: "Kupon doğrulanamadı." }, { status: 500 });
    }
}
