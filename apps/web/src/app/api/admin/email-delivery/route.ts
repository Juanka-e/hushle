import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { requireAdminSession } from "@/lib/admin/require-admin";
import { listEmailDeliveryForAdmin } from "@/lib/email-delivery/admin-service";
import {
    buildRateLimitHeaders,
    consumeRequestRateLimit,
    getRequestIp,
} from "@/lib/security/request-rate-limit";

export const dynamic = "force-dynamic";

const querySchema = z.object({
    page: z.coerce.number().int().min(1).default(1),
    limit: z.coerce.number().int().min(1).max(50).default(20),
    status: z.enum(["all", "pending", "processing", "sent", "dead_letter"]).default("dead_letter"),
    search: z.string().trim().max(191).optional(),
});

export async function GET(request: NextRequest) {
    const admin = await requireAdminSession();
    if (admin instanceof NextResponse) return admin;
    const rateLimit = consumeRequestRateLimit({
        bucket: "admin-email-delivery-read",
        key: `admin:${admin.id}:${getRequestIp(request)}`,
        windowMs: 60_000,
        maxRequests: 90,
    });
    if (!rateLimit.allowed) {
        return NextResponse.json(
            { error: "Çok fazla e-posta kuyruğu isteği. Lütfen biraz bekleyin." },
            { status: 429, headers: buildRateLimitHeaders(rateLimit) }
        );
    }

    const parsed = querySchema.safeParse({
        page: request.nextUrl.searchParams.get("page") ?? undefined,
        limit: request.nextUrl.searchParams.get("limit") ?? undefined,
        status: request.nextUrl.searchParams.get("status") ?? undefined,
        search: request.nextUrl.searchParams.get("search") || undefined,
    });
    if (!parsed.success) {
        return NextResponse.json({ error: "Geçersiz e-posta kuyruğu sorgusu." }, { status: 422 });
    }

    try {
        return NextResponse.json(await listEmailDeliveryForAdmin(parsed.data), {
            headers: buildRateLimitHeaders(rateLimit),
        });
    } catch (error) {
        console.error("Failed to load email delivery queue", error);
        return NextResponse.json({ error: "E-posta kuyruğu yüklenemedi." }, { status: 500 });
    }
}
