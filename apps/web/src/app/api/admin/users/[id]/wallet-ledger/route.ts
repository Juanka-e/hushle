import { NextRequest, NextResponse } from "next/server";
import { requireAdminSession } from "@/lib/admin/require-admin";
import {
    adminWalletLedgerParamsSchema,
    adminWalletLedgerQuerySchema,
} from "@/lib/wallet-ledger/admin-schema";
import { getAdminWalletLedger } from "@/lib/wallet-ledger/admin-service";
import {
    buildRateLimitHeaders,
    consumeRequestRateLimit,
    getRequestIp,
} from "@/lib/security/request-rate-limit";

export const dynamic = "force-dynamic";

export async function GET(
    request: NextRequest,
    context: { params: Promise<{ id: string }> }
) {
    const adminSession = await requireAdminSession();
    if (adminSession instanceof NextResponse) return adminSession;

    const rateLimit = consumeRequestRateLimit({
        bucket: "admin-wallet-ledger-read",
        key: `admin:${adminSession.id}:${getRequestIp(request)}`,
        windowMs: 60_000,
        maxRequests: 120,
    });
    if (!rateLimit.allowed) {
        return NextResponse.json(
            { error: "Çok fazla cüzdan geçmişi isteği. Lütfen biraz bekleyin." },
            {
                status: 429,
                headers: buildRateLimitHeaders(rateLimit),
            }
        );
    }

    const params = adminWalletLedgerParamsSchema.safeParse(await context.params);
    const { searchParams } = new URL(request.url);
    const query = adminWalletLedgerQuerySchema.safeParse({
        page: searchParams.get("page") ?? undefined,
        limit: searchParams.get("limit") ?? undefined,
    });
    if (!params.success || !query.success) {
        return NextResponse.json(
            { error: "Geçersiz cüzdan geçmişi isteği." },
            { status: 422 }
        );
    }

    const result = await getAdminWalletLedger(params.data.id, query.data);
    if (!result) {
        return NextResponse.json(
            { error: "Kullanıcı bulunamadı." },
            { status: 404 }
        );
    }

    return NextResponse.json(result, {
        headers: buildRateLimitHeaders(rateLimit),
    });
}
