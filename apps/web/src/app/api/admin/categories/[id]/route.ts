import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { z } from "zod";
import { invalidateCategoryCache } from "@/lib/socket/category-service";
import {
    assertCategoryCanBeDeleted,
    validateAdminCategoryInput,
} from "@/lib/categories/admin-category-policy";
import { requireAdminSession } from "@/lib/admin/require-admin";
import {
    buildRateLimitHeaders,
    consumeRequestRateLimit,
    getRequestIp,
} from "@/lib/security/request-rate-limit";
import {
    GAME_CONTENT_LOCALES,
    normalizeGameContentLocale,
} from "@hushle/domain-game";

export const dynamic = "force-dynamic";

const updateCategorySchema = z.object({
    name: z.string().min(1).max(255).optional(),
    parentId: z.number().nullable().optional(),
    color: z.string().max(7).nullable().optional(),
    sortOrder: z.number().optional(),
    isVisible: z.boolean().optional(),
    locale: z.enum(GAME_CONTENT_LOCALES).optional(),
});

export async function PUT(
    request: NextRequest,
    { params }: { params: Promise<{ id: string }> }
) {
    const adminSession = await requireAdminSession();
    if (adminSession instanceof NextResponse) {
        return adminSession;
    }

    const rateLimit = consumeRequestRateLimit({
        bucket: "admin-category-update",
        key: `admin:${adminSession.id}:${getRequestIp(request)}`,
        windowMs: 60_000,
        maxRequests: 30,
    });
    if (!rateLimit.allowed) {
        return NextResponse.json(
            { error: "Cok fazla kategori guncelleme denemesi. Lutfen biraz bekleyin." },
            { status: 429, headers: buildRateLimitHeaders(rateLimit) }
        );
    }

    try {
        const { id } = await params;
        const categoryId = parseInt(id, 10);
        const body = await request.json();
        const parsed = updateCategorySchema.parse(body);
        const currentCategory = await prisma.category.findUnique({
            where: { id: categoryId },
            select: { locale: true, parentId: true },
        });
        if (!currentCategory) {
            return NextResponse.json({ error: "Kategori bulunamadı." }, { status: 404 });
        }
        if (parsed.locale && parsed.locale !== currentCategory.locale) {
            const relationCount = await prisma.wordCategory.count({ where: { categoryId } });
            const childCount = await prisma.category.count({ where: { parentId: categoryId } });
            if (relationCount > 0 || childCount > 0) {
                throw new Error("Bağlı kelimesi veya alt kategorisi olan kategorinin dili değiştirilemez.");
            }
        }
        const data = await validateAdminCategoryInput(
            {
                ...parsed,
                parentId: parsed.parentId === undefined ? currentCategory.parentId : parsed.parentId,
                locale: parsed.locale ?? normalizeGameContentLocale(currentCategory.locale),
            },
            categoryId
        );

        const category = await prisma.category.update({
            where: { id: categoryId },
            data,
        });

        await invalidateCategoryCache();
        return NextResponse.json(category, { headers: buildRateLimitHeaders(rateLimit) });
    } catch (error) {
        if (error instanceof z.ZodError) {
            return NextResponse.json(
                { error: "Gecersiz veri." },
                { status: 400 }
            );
        }
        if (error instanceof Error) {
            return NextResponse.json(
                { error: error.message },
                { status: 400 }
            );
        }
        console.error("Failed to update category:", error);
        return NextResponse.json(
            { error: "Kategori guncellenemedi." },
            { status: 500 }
        );
    }
}

export async function DELETE(
    request: NextRequest,
    { params }: { params: Promise<{ id: string }> }
) {
    const adminSession = await requireAdminSession();
    if (adminSession instanceof NextResponse) {
        return adminSession;
    }

    const rateLimit = consumeRequestRateLimit({
        bucket: "admin-category-delete",
        key: `admin:${adminSession.id}:${getRequestIp(request)}`,
        windowMs: 60_000,
        maxRequests: 20,
    });
    if (!rateLimit.allowed) {
        return NextResponse.json(
            { error: "Cok fazla kategori silme denemesi. Lutfen biraz bekleyin." },
            { status: 429, headers: buildRateLimitHeaders(rateLimit) }
        );
    }

    try {
        const { id } = await params;
        const categoryId = parseInt(id, 10);
        await assertCategoryCanBeDeleted(categoryId);
        await prisma.category.delete({ where: { id: categoryId } });
        await invalidateCategoryCache();
        return NextResponse.json({ success: true }, { headers: buildRateLimitHeaders(rateLimit) });
    } catch (error) {
        if (error instanceof Error) {
            return NextResponse.json(
                { error: error.message },
                { status: 400 }
            );
        }
        console.error("Failed to delete category:", error);
        return NextResponse.json(
            { error: "Kategori silinemedi." },
            { status: 500 }
        );
    }
}
