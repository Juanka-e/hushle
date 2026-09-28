import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { requireAdminSession } from "@/lib/admin/require-admin";
import { supportAdminListQuerySchema } from "@/lib/support/schema";
import { listSupportTicketsForAdmin } from "@/lib/support/service";
import {
    buildRateLimitHeaders,
    consumeRequestRateLimit,
    getRequestIp,
} from "@/lib/security/request-rate-limit";

export const dynamic = "force-dynamic";

export async function GET(request: NextRequest) {
    const adminSession = await requireAdminSession();
    if (adminSession instanceof NextResponse) {
        return adminSession;
    }

    const rateLimit = consumeRequestRateLimit({
        bucket: "admin-support-tickets-read",
        key: `admin:${adminSession.id}:${getRequestIp(request)}`,
        windowMs: 60_000,
        maxRequests: 90,
    });
    if (!rateLimit.allowed) {
        return NextResponse.json(
            { error: "Cok fazla destek listesi istegi. Lutfen biraz bekleyin." },
            { status: 429, headers: buildRateLimitHeaders(rateLimit) }
        );
    }

    try {
        const query = supportAdminListQuerySchema.parse({
            page: request.nextUrl.searchParams.get("page") ?? undefined,
            limit: request.nextUrl.searchParams.get("limit") ?? undefined,
            search: request.nextUrl.searchParams.get("search") ?? undefined,
            status: request.nextUrl.searchParams.get("status") ?? undefined,
        });

        const result = await listSupportTicketsForAdmin(query);
        return NextResponse.json(result, { headers: buildRateLimitHeaders(rateLimit) });
    } catch (error) {
        if (error instanceof z.ZodError) {
            return NextResponse.json(
                { error: error.issues[0]?.message || "Gecersiz destek sorgusu." },
                { status: 422 }
            );
        }

        console.error("Failed to load support tickets:", error);
        return NextResponse.json({ error: "Destek listesi yuklenemedi." }, { status: 500 });
    }
}

