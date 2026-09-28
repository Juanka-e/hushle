import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { requireAdminSession } from "@/lib/admin/require-admin";
import { walletAdjustmentSchema } from "@/lib/admin-user-operations/schema";
import { applyAdminWalletAdjustment } from "@/lib/admin-user-operations/service";
import { writeAuditLog } from "@/lib/security/audit-log";
import {
    buildRateLimitHeaders,
    consumeDistributedRequestRateLimit,
    getRequestIp,
} from "@/lib/security/request-rate-limit";

export const dynamic = "force-dynamic";

const routeParamsSchema = z.object({
    id: z.coerce.number().int().min(1),
});

export async function POST(
    request: NextRequest,
    context: { params: Promise<{ id: string }> }
) {
    const adminSession = await requireAdminSession();
    if (adminSession instanceof NextResponse) {
        return adminSession;
    }

    const params = await context.params;
    const parsedParams = routeParamsSchema.safeParse(params);
    if (!parsedParams.success) {
        return NextResponse.json({ error: "Gecersiz kullanici." }, { status: 422 });
    }

    try {
        const rateLimit = await consumeDistributedRequestRateLimit({
            bucket: "admin-wallet-adjustment",
            key: `admin:${adminSession.id}:${getRequestIp(request)}`,
            windowMs: 60_000,
            maxRequests: 20,
        });
        if (!rateLimit.allowed) {
            return NextResponse.json(
                { error: "Cok fazla coin operasyonu denemesi. Lutfen biraz bekleyin." },
                { status: 429, headers: buildRateLimitHeaders(rateLimit) }
            );
        }

        const body = await request.json();
        const adjustment = walletAdjustmentSchema.parse(body);

        const result = await applyAdminWalletAdjustment({
            admin: adminSession,
            targetUserId: parsedParams.data.id,
            adjustment,
        });

        if (!result.ok) {
            if (result.code === "not_found") {
                return NextResponse.json({ error: "Kullanici bulunamadi." }, { status: 404 });
            }
            if (result.code === "target_is_admin") {
                return NextResponse.json(
                    { error: "Admin hesaplarinin bakiyesi bu panelden degistirilemez." },
                    { status: 403 }
                );
            }

            return NextResponse.json(
                { error: "Kullanici bakiyesi bu islem icin yetersiz." },
                { status: 409 }
            );
        }

        await writeAuditLog({
            actor: adminSession,
            action: `admin.user.wallet.${adjustment.adjustmentType}`,
            resourceType: "wallet_adjustment",
            resourceId: result.adjustment.id,
            summary: `${adjustment.adjustmentType} ${adjustment.amount} coin for ${result.targetUsername}`,
            metadata: {
                rewardSource: "admin_adjustment",
                targetUserId: parsedParams.data.id,
                targetUsername: result.targetUsername,
                adjustmentType: adjustment.adjustmentType,
                amount: adjustment.amount,
                balanceBefore: result.adjustment.balanceBefore,
                balanceAfter: result.adjustment.balanceAfter,
            },
            request,
        });

        return NextResponse.json({
            ok: true,
            adjustment: result.adjustment,
            coinBalance: result.coinBalance,
        });
    } catch (error) {
        if (error instanceof z.ZodError) {
            return NextResponse.json(
                { error: error.issues[0]?.message || "Gecersiz coin operasyon verisi." },
                { status: 422 }
            );
        }

        console.error("Failed to apply wallet adjustment:", error);
        return NextResponse.json(
            { error: "Coin operasyonu uygulanamadi." },
            { status: 500 }
        );
    }
}
