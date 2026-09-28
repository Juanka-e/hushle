import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { prisma } from "@/lib/prisma";
import { requireAdminSession } from "@/lib/admin/require-admin";
import {
    buildRateLimitHeaders,
    consumeDistributedRequestRateLimit,
    getRequestIp,
} from "@/lib/security/request-rate-limit";
import { writeAuditLog } from "@/lib/security/audit-log";
import { invalidateAdminDashboardStatsCache } from "@/lib/cache/application-cache";

export const dynamic = "force-dynamic";
const REASON_THRESHOLD = 10;

const bulkDeleteSchema = z.object({
    ids: z.array(z.number().int().positive()).min(1).max(100),
    reason: z.string().trim().max(500).optional().default(""),
});

export async function POST(request: NextRequest) {
    const adminSession = await requireAdminSession();
    if (adminSession instanceof NextResponse) {
        return adminSession;
    }

    const rateLimit = await consumeDistributedRequestRateLimit({
        bucket: "admin-words-bulk-delete",
        key: `admin:${adminSession.id}:${getRequestIp(request)}`,
        windowMs: 60_000,
        maxRequests: 10,
    });
    if (!rateLimit.allowed) {
        return NextResponse.json(
            { error: "Cok fazla toplu kelime silme denemesi. Lutfen biraz bekleyin." },
            { status: 429, headers: buildRateLimitHeaders(rateLimit) }
        );
    }

    try {
        const body = await request.json();
        const { ids, reason } = bulkDeleteSchema.parse(body);
        const uniqueIds = Array.from(new Set(ids));

        if (uniqueIds.length >= REASON_THRESHOLD && reason.trim().length < 8) {
            return NextResponse.json(
                { error: `${REASON_THRESHOLD} veya daha fazla kelime silerken aciklayici bir not girmelisin.` },
                { status: 422, headers: buildRateLimitHeaders(rateLimit) }
            );
        }

        const words = await prisma.word.findMany({
            where: { id: { in: uniqueIds } },
            select: { id: true, wordText: true },
        });

        const result = await prisma.word.deleteMany({
            where: {
                id: { in: uniqueIds },
            },
        });

        await writeAuditLog({
            actor: adminSession,
            action: "admin.word.bulk_delete",
            resourceType: "word",
            summary: `Bulk deleted ${result.count} word records`,
            metadata: {
                selectedCount: uniqueIds.length,
                deletedCount: result.count,
                reason: reason.trim() || null,
                wordIds: words.map((word) => word.id),
                wordTexts: words.map((word) => word.wordText).slice(0, 20),
            },
            request,
        });
        await invalidateAdminDashboardStatsCache();

        return NextResponse.json(
            { success: true, deletedCount: result.count },
            { headers: buildRateLimitHeaders(rateLimit) }
        );
    } catch (error) {
        if (error instanceof z.ZodError) {
            return NextResponse.json(
                { error: "Gecersiz toplu silme verisi.", details: error.issues },
                { status: 400, headers: buildRateLimitHeaders(rateLimit) }
            );
        }

        console.error("Failed to bulk delete words:", error);
        return NextResponse.json(
            { error: "Kelime kayitlari silinemedi." },
            { status: 500, headers: buildRateLimitHeaders(rateLimit) }
        );
    }
}
