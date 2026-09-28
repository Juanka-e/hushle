import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { prisma } from "@/lib/prisma";
import { requireAdminSession } from "@/lib/admin/require-admin";
import { invalidateStoreCatalogCache } from "@/lib/cache/application-cache";
import { writeAuditLog } from "@/lib/security/audit-log";
import {
    buildRateLimitHeaders,
    consumeRequestRateLimit,
    getRequestIp,
} from "@/lib/security/request-rate-limit";
import {
    normalizePromotionBulkIds,
    promotionBulkStatusSchema,
} from "@/lib/promotions/bulk-status";

export async function PUT(request: NextRequest) {
    const adminSession = await requireAdminSession();
    if (adminSession instanceof NextResponse) {
        return adminSession;
    }

    const rateLimit = consumeRequestRateLimit({
        bucket: "admin-promotions-bulk-status",
        key: `admin:${adminSession.id}:${getRequestIp(request)}`,
        windowMs: 60_000,
        maxRequests: 10,
    });
    if (!rateLimit.allowed) {
        return NextResponse.json(
            {
                error: "Çok fazla toplu promosyon işlemi. Lütfen biraz bekleyin.",
            },
            { status: 429, headers: buildRateLimitHeaders(rateLimit) }
        );
    }

    try {
        const input = promotionBulkStatusSchema.parse(await request.json());
        const ids = normalizePromotionBulkIds(input.ids);
        const result =
            input.kind === "bundles"
                ? await prisma.shopBundle.updateMany({
                      where: { id: { in: ids } },
                      data: { isActive: input.isActive },
                  })
                : input.kind === "discounts"
                  ? await prisma.discountCampaign.updateMany({
                        where: { id: { in: ids } },
                        data: { isActive: input.isActive },
                    })
                  : await prisma.couponCode.updateMany({
                        where: { id: { in: ids } },
                        data: { isActive: input.isActive },
                    });

        await invalidateStoreCatalogCache();
        await writeAuditLog({
            actor: adminSession,
            action: "admin.promotion.bulk_status",
            resourceType: "promotion_collection",
            resourceId: input.kind,
            summary: `${input.kind} bulk status changed`,
            metadata: {
                kind: input.kind,
                requestedCount: ids.length,
                updatedCount: result.count,
                isActive: input.isActive,
                ids,
            },
            request,
        });

        return NextResponse.json(
            {
                updatedCount: result.count,
                requestedCount: ids.length,
                isActive: input.isActive,
            },
            { headers: buildRateLimitHeaders(rateLimit) }
        );
    } catch (error) {
        if (error instanceof z.ZodError) {
            return NextResponse.json(
                { error: "Geçersiz toplu promosyon isteği.", details: error.issues },
                { status: 400, headers: buildRateLimitHeaders(rateLimit) }
            );
        }

        console.error("Promotion bulk status update failed:", error);
        return NextResponse.json(
            { error: "Toplu promosyon işlemi tamamlanamadı." },
            { status: 500, headers: buildRateLimitHeaders(rateLimit) }
        );
    }
}
