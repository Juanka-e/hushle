import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { z } from "zod";
import { invalidateCategoryCache } from "@/lib/socket/category-service";
import { requireAdminSession } from "@/lib/admin/require-admin";
import { writeAuditLog } from "@/lib/security/audit-log";
import {
    buildRateLimitHeaders,
    consumeDistributedRequestRateLimit,
    getRequestIp,
} from "@/lib/security/request-rate-limit";
import { hasCategoryHierarchyConflict } from "@/lib/categories/admin-category-policy";

export const dynamic = "force-dynamic";

const moveDeleteSchema = z.object({
    targetCategoryId: z.number().int().positive(),
});

export async function POST(
    request: NextRequest,
    { params }: { params: Promise<{ id: string }> }
) {
    const adminSession = await requireAdminSession();
    if (adminSession instanceof NextResponse) {
        return adminSession;
    }

    const rateLimit = await consumeDistributedRequestRateLimit({
        bucket: "admin-category-move-delete",
        key: `admin:${adminSession.id}:${getRequestIp(request)}`,
        windowMs: 60_000,
        maxRequests: 15,
    });
    if (!rateLimit.allowed) {
        return NextResponse.json(
            { error: "Cok fazla kategori tasima ve silme denemesi. Lutfen biraz bekleyin." },
            { status: 429, headers: buildRateLimitHeaders(rateLimit) }
        );
    }

    try {
        const { id } = await params;
        const sourceCategoryId = Number.parseInt(id, 10);
        const body = await request.json();
        const { targetCategoryId } = moveDeleteSchema.parse(body);

        if (sourceCategoryId === targetCategoryId) {
            return NextResponse.json(
                { error: "Kaynak ve hedef kategori ayni olamaz." },
                { status: 400, headers: buildRateLimitHeaders(rateLimit) }
            );
        }

        const [sourceCategory, targetCategory, allCategories, childCategories, sourceLinks] = await Promise.all([
            prisma.category.findUnique({
                where: { id: sourceCategoryId },
                select: { id: true, name: true, parentId: true, locale: true },
            }),
            prisma.category.findUnique({
                where: { id: targetCategoryId },
                select: { id: true, name: true, parentId: true, locale: true },
            }),
            prisma.category.findMany({
                select: { id: true, name: true, parentId: true },
            }),
            prisma.category.findMany({
                where: { parentId: sourceCategoryId },
                select: { id: true, name: true },
            }),
            prisma.wordCategory.findMany({
                where: { categoryId: sourceCategoryId },
                select: { wordId: true },
            }),
        ]);

        if (!sourceCategory || !targetCategory) {
            return NextResponse.json(
                { error: "Kategori bulunamadi." },
                { status: 404, headers: buildRateLimitHeaders(rateLimit) }
            );
        }

        if (sourceCategory.locale !== targetCategory.locale) {
            return NextResponse.json(
                { error: "Kategoriler yalnızca aynı kelime dilindeki bir kategoriye taşınabilir." },
                { status: 400, headers: buildRateLimitHeaders(rateLimit) }
            );
        }

        if (sourceCategory.parentId === null && targetCategory.parentId !== null) {
            return NextResponse.json(
                { error: "Ana kategori ancak baska bir ana kategoriye tasinarak silinebilir." },
                { status: 400, headers: buildRateLimitHeaders(rateLimit) }
            );
        }

        const categoriesById = new Map(allCategories.map((category) => [category.id, category]));
        const affectedWordIds = Array.from(new Set(sourceLinks.map((link) => link.wordId)));

        if (affectedWordIds.length > 0) {
            const allWordLinks = await prisma.wordCategory.findMany({
                where: { wordId: { in: affectedWordIds } },
                select: {
                    wordId: true,
                    categoryId: true,
                    word: { select: { wordText: true } },
                },
            });

            const categoriesByWord = new Map<number, number[]>();
            const wordTextById = new Map<number, string>();

            for (const link of allWordLinks) {
                const current = categoriesByWord.get(link.wordId) ?? [];
                current.push(link.categoryId);
                categoriesByWord.set(link.wordId, current);
                wordTextById.set(link.wordId, link.word.wordText);
            }

            const conflictingWords: string[] = [];
            for (const wordId of affectedWordIds) {
                const currentCategoryIds = categoriesByWord.get(wordId) ?? [];
                const nextCategoryIds = Array.from(
                    new Set(
                        currentCategoryIds
                            .filter((categoryId) => categoryId !== sourceCategoryId)
                            .concat(targetCategoryId)
                    )
                );

                if (hasCategoryHierarchyConflict(nextCategoryIds, categoriesById)) {
                    conflictingWords.push(wordTextById.get(wordId) ?? `#${wordId}`);
                }
            }

            if (conflictingWords.length > 0) {
                return NextResponse.json(
                    {
                        error: `Tasimadan sonra bazi kelimeler ana kategori / alt kategori cakismasina giriyor: ${conflictingWords.slice(0, 5).join(", ")}.`,
                    },
                    { status: 409, headers: buildRateLimitHeaders(rateLimit) }
                );
            }
        }

        const existingTargetLinks = new Set(
            (
                await prisma.wordCategory.findMany({
                    where: {
                        wordId: { in: affectedWordIds },
                        categoryId: targetCategoryId,
                    },
                    select: { wordId: true },
                })
            ).map((link) => link.wordId)
        );

        await prisma.$transaction(async (tx) => {
            if (childCategories.length > 0) {
                await tx.category.updateMany({
                    where: { parentId: sourceCategoryId },
                    data: { parentId: targetCategoryId },
                });
            }

            await tx.wordCategory.deleteMany({
                where: { categoryId: sourceCategoryId },
            });

            const missingTargetLinks = affectedWordIds
                .filter((wordId) => !existingTargetLinks.has(wordId))
                .map((wordId) => ({
                    wordId,
                    categoryId: targetCategoryId,
                }));

            if (missingTargetLinks.length > 0) {
                await tx.wordCategory.createMany({
                    data: missingTargetLinks,
                });
            }

            await tx.category.delete({
                where: { id: sourceCategoryId },
            });
        });

        await invalidateCategoryCache();

        await writeAuditLog({
            actor: adminSession,
            action: "admin.category.move_delete",
            resourceType: "category",
            resourceId: sourceCategoryId,
            summary: `Moved category bindings from ${sourceCategory.name} to ${targetCategory.name} before delete`,
            metadata: {
                sourceCategoryId,
                sourceCategoryName: sourceCategory.name,
                targetCategoryId,
                targetCategoryName: targetCategory.name,
                movedWordCount: affectedWordIds.length,
                movedChildCategoryCount: childCategories.length,
                movedChildCategoryIds: childCategories.map((category) => category.id),
                movedChildCategoryNames: childCategories.map((category) => category.name),
            },
            request,
        });

        return NextResponse.json(
            {
                success: true,
                movedWordCount: affectedWordIds.length,
                movedChildCategoryCount: childCategories.length,
            },
            { headers: buildRateLimitHeaders(rateLimit) }
        );
    } catch (error) {
        if (error instanceof z.ZodError) {
            return NextResponse.json(
                { error: "Gecersiz tasima verisi.", details: error.issues },
                { status: 400, headers: buildRateLimitHeaders(rateLimit) }
            );
        }

        console.error("Failed to move and delete category:", error);
        return NextResponse.json(
            { error: "Kategori tasinip silinemedi." },
            { status: 500, headers: buildRateLimitHeaders(rateLimit) }
        );
    }
}
