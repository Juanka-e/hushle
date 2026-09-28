import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { z } from "zod";
import { Prisma } from "@hushle/platform-db";
import { validateWordCategorySelection } from "@/lib/words/category-assignment-policy";
import { invalidateAdminDashboardStatsCache } from "@/lib/cache/application-cache";
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

// GET - Get a single word
export async function GET(
    request: NextRequest,
    { params }: { params: Promise<{ id: string }> }
) {
    const adminSession = await requireAdminSession();
    if (adminSession instanceof NextResponse) {
        return adminSession;
    }

    const rateLimit = consumeRequestRateLimit({
        bucket: "admin-word-read",
        key: `admin:${adminSession.id}:${getRequestIp(request)}`,
        windowMs: 60_000,
        maxRequests: 120,
    });
    if (!rateLimit.allowed) {
        return NextResponse.json(
            { error: "Cok fazla kelime detay istegi. Lutfen biraz bekleyin." },
            { status: 429, headers: buildRateLimitHeaders(rateLimit) }
        );
    }

    const { id } = await params;
    const word = await prisma.word.findUnique({
        where: { id: parseInt(id) },
        include: {
            tabooWords: true,
            wordCategories: { include: { category: true } },
        },
    });

    if (!word) {
        return NextResponse.json({ error: "Kelime bulunamadı." }, { status: 404 });
    }

    return NextResponse.json(word, { headers: buildRateLimitHeaders(rateLimit) });
}

// PUT - Update a word
const updateWordSchema = z.object({
    wordText: z.string().min(1).max(255).optional(),
    difficulty: z.number().min(1).max(3).optional(),
    tabooWords: z.array(z.string().min(1).max(255)).optional(),
    categoryIds: z.array(z.number()).optional(),
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
        bucket: "admin-word-update",
        key: `admin:${adminSession.id}:${getRequestIp(request)}`,
        windowMs: 60_000,
        maxRequests: 40,
    });
    if (!rateLimit.allowed) {
        return NextResponse.json(
            { error: "Cok fazla kelime guncelleme denemesi. Lutfen biraz bekleyin." },
            { status: 429, headers: buildRateLimitHeaders(rateLimit) }
        );
    }

    try {
        const { id } = await params;
        const wordId = parseInt(id);
        const body = await request.json();
        const data = updateWordSchema.parse(body);
        const currentWord = await prisma.word.findUnique({
            where: { id: wordId },
            select: { locale: true, wordText: true },
        });
        if (!currentWord) {
            return NextResponse.json({ error: "Kelime bulunamadı." }, { status: 404 });
        }
        const nextLocale = data.locale ?? normalizeGameContentLocale(currentWord.locale);
        if (data.locale && data.locale !== currentWord.locale && data.categoryIds === undefined) {
            return NextResponse.json(
                { error: "Kelime dilini değiştirirken kategorileri yeniden seçmelisiniz." },
                { status: 400, headers: buildRateLimitHeaders(rateLimit) }
            );
        }

        const nextWordText = data.wordText?.trim() ?? currentWord.wordText;
        const duplicateWord = await prisma.word.findFirst({
            where: {
                id: { not: wordId },
                locale: nextLocale,
                wordText: nextWordText,
            },
            select: { id: true },
        });
        if (duplicateWord) {
            return NextResponse.json(
                { error: "Bu kelime seçilen dil paketinde zaten mevcut." },
                { status: 409, headers: buildRateLimitHeaders(rateLimit) }
            );
        }
        const normalizedCategoryIds = data.categoryIds
            ? (await validateWordCategorySelection(data.categoryIds, nextLocale)).normalizedCategoryIds
            : undefined;

        // Update word and related data in a transaction
        const word = await prisma.$transaction(async (tx: Prisma.TransactionClient) => {
            // Update main word data
            await tx.word.update({
                where: { id: wordId },
                data: {
                    wordText: data.wordText,
                    difficulty: data.difficulty,
                    locale: data.locale,
                },
            });

            // Update taboo words if provided
            if (data.tabooWords) {
                await tx.tabooWord.deleteMany({ where: { wordId } });
                await tx.tabooWord.createMany({
                    data: data.tabooWords.map((tw) => ({
                        wordId,
                        tabooWordText: tw,
                    })),
                });
            }

            // Update categories if provided
            if (normalizedCategoryIds) {
                await tx.wordCategory.deleteMany({ where: { wordId } });
                await tx.wordCategory.createMany({
                    data: normalizedCategoryIds.map((catId) => ({
                        wordId,
                        categoryId: catId,
                    })),
                });
            }

            return tx.word.findUnique({
                where: { id: wordId },
                include: {
                    tabooWords: true,
                    wordCategories: { include: { category: true } },
                },
            });
        });
        await invalidateAdminDashboardStatsCache();

        return NextResponse.json(word, { headers: buildRateLimitHeaders(rateLimit) });
    } catch (error) {
        if (error instanceof z.ZodError) {
            return NextResponse.json(
                { error: "Geçersiz veri.", details: error.issues },
                { status: 400 }
            );
        }
        if (error instanceof Error) {
            return NextResponse.json({ error: error.message }, { status: 400 });
        }
        console.error("Failed to update word:", error);
        return NextResponse.json(
            { error: "Kelime güncellenemedi." },
            { status: 500 }
        );
    }
}

// DELETE - Delete a word
export async function DELETE(
    request: NextRequest,
    { params }: { params: Promise<{ id: string }> }
) {
    const adminSession = await requireAdminSession();
    if (adminSession instanceof NextResponse) {
        return adminSession;
    }

    const rateLimit = consumeRequestRateLimit({
        bucket: "admin-word-delete",
        key: `admin:${adminSession.id}:${getRequestIp(request)}`,
        windowMs: 60_000,
        maxRequests: 20,
    });
    if (!rateLimit.allowed) {
        return NextResponse.json(
            { error: "Cok fazla kelime silme denemesi. Lutfen biraz bekleyin." },
            { status: 429, headers: buildRateLimitHeaders(rateLimit) }
        );
    }

    try {
        const { id } = await params;
        await prisma.word.delete({ where: { id: parseInt(id) } });
        await invalidateAdminDashboardStatsCache();
        return NextResponse.json({ success: true }, { headers: buildRateLimitHeaders(rateLimit) });
    } catch (error) {
        console.error("Failed to delete word:", error);
        return NextResponse.json(
            { error: "Kelime silinemedi." },
            { status: 500 }
        );
    }
}
