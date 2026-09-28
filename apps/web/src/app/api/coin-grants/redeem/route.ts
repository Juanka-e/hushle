import { NextRequest, NextResponse } from "next/server";
import { getSessionUser } from "@/lib/session";
import { enforceAccountCapability } from "@/lib/auth/account-capability";
import { coinGrantRedeemSchema } from "@/lib/coin-grants/schema";
import { redeemCoinGrantCode } from "@/lib/coin-grants/service";
import { writeAuditLog } from "@/lib/security/audit-log";
import {
    buildRateLimitHeaders,
    consumeDistributedRequestRateLimit,
    getRequestIp,
} from "@/lib/security/request-rate-limit";

export const dynamic = "force-dynamic";

export async function POST(request: NextRequest) {
    const sessionUser = await getSessionUser();
    if (!sessionUser) {
        return NextResponse.json({ error: "Giris gerekli." }, { status: 401 });
    }
    const capabilityError = enforceAccountCapability(sessionUser, "reward");
    if (capabilityError) return capabilityError;

    const rateLimit = await consumeDistributedRequestRateLimit({
        bucket: "coin-grant-redeem",
        key: `user:${sessionUser.id}:${getRequestIp(request)}`,
        windowMs: 60_000,
        maxRequests: 12,
    });
    if (!rateLimit.allowed) {
        return NextResponse.json(
            { error: "Cok fazla coin kodu denemesi. Lutfen biraz bekleyin." },
            { status: 429, headers: buildRateLimitHeaders(rateLimit) }
        );
    }

    try {
        const body = await request.json();
        const redeem = coinGrantRedeemSchema.parse(body);
        const result = await redeemCoinGrantCode({ userId: sessionUser.id, redeem });

        if (!result.ok) {
            const status = result.code === "not_found" ? 404 : 409;
            return NextResponse.json(
                { error: "Coin kodu gecersiz veya su anda kullanilamaz." },
                { status }
            );
        }

        await writeAuditLog({
            actor: sessionUser,
            action: "user.coin_grant.claim",
            resourceType: "coin_grant_claim",
            resourceId: result.claim.id,
            summary: `claimed ${result.coinAmount} coin via ${result.code.code}`,
            metadata: {
                rewardSource: "promo_claim",
                campaignId: result.campaign.id,
                campaignCode: result.campaign.code,
                grantCode: result.code.code,
                coinAmount: result.coinAmount,
                coinBalance: result.coinBalance,
            },
            request,
        });

        return NextResponse.json({
            ok: true,
            coinAmount: result.coinAmount,
            coinBalance: result.coinBalance,
        });
    } catch (error) {
        if (error instanceof Error && "issues" in error) {
            const zodError = error as Error & { issues?: Array<{ message?: string }> };
            return NextResponse.json({ error: zodError.issues?.[0]?.message || "Gecersiz coin kodu." }, { status: 422 });
        }

        console.error("Failed to redeem coin grant code:", error);
        return NextResponse.json({ error: "Coin kodu kullanilamadi." }, { status: 500 });
    }
}
