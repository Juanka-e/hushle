import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { requireAdminSession } from "@/lib/admin/require-admin";
import {
    AdminCategoryReorderValidationError,
    validateAdminCategoryReorderUpdates,
} from "@/lib/categories/admin-category-reorder";
import { invalidateCategoryCache } from "@/lib/socket/category-service";
import { writeAuditLog } from "@/lib/security/audit-log";
import {
    buildRateLimitHeaders,
    consumeRequestRateLimit,
    getRequestIp,
} from "@/lib/security/request-rate-limit";
import { z } from "zod";
import { GAME_CONTENT_LOCALES } from "@hushle/domain-game";

export const dynamic = "force-dynamic";

const reorderRequestSchema = z.object({
    locale: z.enum(GAME_CONTENT_LOCALES),
    updates: z.array(z.object({
        id: z.number().int().positive(),
        sortOrder: z.number().int().nonnegative(),
    })).min(1).max(100),
});

export async function POST(request: NextRequest) {
    const adminSession = await requireAdminSession();
    if (adminSession instanceof NextResponse) {
        return adminSession;
    }

    const rateLimit = consumeRequestRateLimit({
        bucket: "admin-categories-reorder",
        key: `admin:${adminSession.id}:${getRequestIp(request)}`,
        windowMs: 60_000,
        maxRequests: 20,
    });
    if (!rateLimit.allowed) {
        return NextResponse.json(
            { error: "Cok fazla kategori siralama denemesi. Lutfen biraz bekleyin." },
            { status: 429, headers: buildRateLimitHeaders(rateLimit) }
        );
    }

    try {
        const body = reorderRequestSchema.parse(await request.json());
        const { updates, locale } = body;
        const categories = await prisma.category.findMany({
            where: { locale },
            select: {
                id: true,
                parentId: true,
                sortOrder: true,
            },
        });
        const normalizedUpdates = validateAdminCategoryReorderUpdates(updates, categories);
        const previousOrder = categories
            .filter((category) => category.parentId === null)
            .sort(
                (left, right) =>
                    left.sortOrder - right.sortOrder || left.id - right.id
            )
            .map((category) => category.id);

        await prisma.$transaction(
            normalizedUpdates.map((item) =>
                prisma.category.update({
                    where: { id: item.id },
                    data: { sortOrder: item.sortOrder },
                })
            )
        );
        await invalidateCategoryCache();

        try {
            await writeAuditLog({
                actor: adminSession,
                action: "admin.category.reorder",
                resourceType: "category",
                summary: "Ana kategori sırası güncellendi",
                metadata: {
                    previousOrder,
                    nextOrder: normalizedUpdates.map((item) => item.id),
                },
                request,
            });
        } catch (auditError) {
            console.error("Category reorder audit could not be written", auditError);
        }

        return NextResponse.json(
            {
                success: true,
                order: normalizedUpdates.map((item) => item.id),
            },
            { headers: buildRateLimitHeaders(rateLimit) }
        );
    } catch (error) {
        if (error instanceof AdminCategoryReorderValidationError) {
            return NextResponse.json(
                { error: error.message },
                {
                    status: 422,
                    headers: buildRateLimitHeaders(rateLimit),
                }
            );
        }
        if (error instanceof SyntaxError || error instanceof z.ZodError) {
            return NextResponse.json(
                { error: "Geçersiz sıralama isteği." },
                {
                    status: 422,
                    headers: buildRateLimitHeaders(rateLimit),
                }
            );
        }
        console.error("Failed to reorder categories:", error);
        return NextResponse.json(
            { error: "Kategori sırası güncellenemedi." },
            {
                status: 500,
                headers: buildRateLimitHeaders(rateLimit),
            }
        );
    }
}
