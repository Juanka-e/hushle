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

export const dynamic = "force-dynamic";

const reorderSchema = z.object({
    updates: z.array(
        z.object({
            id: z.number().int().positive(),
            sortOrder: z.number().int().min(0).max(100_000),
        })
    ).min(1).max(500),
});

export async function POST(request: NextRequest) {
    const adminSession = await requireAdminSession();
    if (adminSession instanceof NextResponse) {
        return adminSession;
    }

    const rateLimit = consumeRequestRateLimit({
        bucket: "admin-shop-items-reorder",
        key: `admin:${adminSession.id}:${getRequestIp(request)}`,
        windowMs: 60_000,
        maxRequests: 20,
    });
    if (!rateLimit.allowed) {
        return NextResponse.json(
            { error: "Cok fazla kozmetik siralama denemesi. Lutfen biraz bekleyin." },
            { status: 429, headers: buildRateLimitHeaders(rateLimit) }
        );
    }

    try {
        const body = await request.json();
        const parsed = reorderSchema.parse(body);

        await prisma.$transaction(
            parsed.updates.map((entry) =>
                prisma.shopItem.update({
                    where: { id: entry.id },
                    data: { sortOrder: entry.sortOrder },
                })
            )
        );
        await invalidateStoreCatalogCache();

        await writeAuditLog({
            actor: adminSession,
            action: "admin.shop-item.reorder",
            resourceType: "shop_item",
            summary: `Reordered ${parsed.updates.length} shop items`,
            metadata: {
                updatedCount: parsed.updates.length,
                itemIds: parsed.updates.map((entry) => entry.id),
            },
            request,
        });

        return NextResponse.json({ success: true }, { headers: buildRateLimitHeaders(rateLimit) });
    } catch (error) {
        if (error instanceof z.ZodError) {
            return NextResponse.json(
                { error: "Gecersiz siralama verisi.", details: error.issues },
                { status: 400 }
            );
        }

        console.error("Failed to reorder shop items:", error);
        return NextResponse.json(
            { error: "Kozmetik siralamasi guncellenemedi." },
            { status: 500 }
        );
    }
}
