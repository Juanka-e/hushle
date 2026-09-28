import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { z } from "zod";
import { validateWordCategorySelection } from "@/lib/words/category-assignment-policy";
import { invalidateAdminDashboardStatsCache } from "@/lib/cache/application-cache";
import { requireAdminSession } from "@/lib/admin/require-admin";
import {
    buildRateLimitHeaders,
    consumeRequestRateLimit,
    getRequestIp,
} from "@/lib/security/request-rate-limit";
import { getWordAnalyticsSummaries } from "@/lib/analytics/word-analytics";
import {
    DEFAULT_GAME_CONTENT_LOCALE,
    GAME_CONTENT_LOCALES,
    normalizeGameContentLocale,
} from "@hushle/domain-game";

export const dynamic = "force-dynamic";

// GET - List words with search & pagination
export async function GET(request: NextRequest) {
    const adminSession = await requireAdminSession();
    if (adminSession instanceof NextResponse) {
        return adminSession;
    }

    const rateLimit = consumeRequestRateLimit({
        bucket: "admin-words-read",
        key: `${adminSession.id}:${getRequestIp(request)}`,
        windowMs: 60_000,
        maxRequests: 60,
    });

    if (!rateLimit.allowed) {
        return NextResponse.json(
            { error: "Cok fazla istek gonderildi. Lutfen bekleyin." },
            {
                status: 429,
                headers: buildRateLimitHeaders(rateLimit),
            }
        );
    }

    const { searchParams } = new URL(request.url);
    const requestedPage = Number.parseInt(searchParams.get("page") || "1", 10);
    const requestedLimit = Number.parseInt(searchParams.get("limit") || "20", 10);
    const page = Number.isSafeInteger(requestedPage) && requestedPage > 0
        ? requestedPage
        : 1;
    const limit = Number.isSafeInteger(requestedLimit)
        ? Math.min(50, Math.max(1, requestedLimit))
        : 20;
    const search = searchParams.get("search") || "";
    const difficulty = searchParams.get("difficulty");
    const categoryId = searchParams.get("categoryId");
    const analyticsDays = searchParams.get("analyticsDays") === "30" ? 30 : 7;
    const locale = normalizeGameContentLocale(searchParams.get("locale"));

    const where: Record<string, unknown> = { locale };

    if (search) {
        where.wordText = { contains: search };
    }
    if (difficulty) {
        where.difficulty = parseInt(difficulty);
    }
    if (categoryId) {
        where.wordCategories = {
            some: { categoryId: parseInt(categoryId) },
        };
    }

    const [words, total] = await Promise.all([
        prisma.word.findMany({
            where,
            include: {
                tabooWords: { select: { id: true, tabooWordText: true } },
                wordCategories: {
                    include: { category: { select: { id: true, name: true, color: true } } },
                },
            },
            orderBy: { id: "desc" },
            skip: (page - 1) * limit,
            take: limit,
        }),
        prisma.word.count({ where }),
    ]);
    const analyticsByWordId = await getWordAnalyticsSummaries(
        words.map((word) => word.id),
        analyticsDays
    );

    return NextResponse.json(
        {
            words,
            total,
            page,
            pages: Math.ceil(total / limit),
            analyticsDays,
            analyticsByWordId,
        },
        {
            headers: buildRateLimitHeaders(rateLimit),
        }
    );
}

// POST - Create a new word
const createWordSchema = z.object({
    wordText: z.string().min(1).max(255),
    difficulty: z.number().min(1).max(3),
    tabooWords: z.array(z.string().min(1).max(255)).min(1).max(10),
    categoryIds: z.array(z.number()).optional(),
    locale: z.enum(GAME_CONTENT_LOCALES).default(DEFAULT_GAME_CONTENT_LOCALE),
});

export async function POST(request: NextRequest) {
    const adminSession = await requireAdminSession();
    if (adminSession instanceof NextResponse) {
        return adminSession;
    }

    const rateLimit = consumeRequestRateLimit({
        bucket: "admin-words-write",
        key: `${adminSession.id}:${getRequestIp(request)}`,
        windowMs: 60_000,
        maxRequests: 40,
    });
    if (!rateLimit.allowed) {
        return NextResponse.json(
            { error: "Cok fazla kelime olusturma denemesi. Lutfen biraz bekleyin." },
            { status: 429, headers: buildRateLimitHeaders(rateLimit) }
        );
    }

    try {
        const body = await request.json();
        const data = createWordSchema.parse(body);
        const { normalizedCategoryIds } = await validateWordCategorySelection(data.categoryIds ?? [], data.locale);

        // Check for duplicate
        const existing = await prisma.word.findUnique({
            where: { locale_wordText: { locale: data.locale, wordText: data.wordText } },
        });
        if (existing) {
            return NextResponse.json(
                { error: "Bu kelime zaten mevcut." },
                { status: 409 }
            );
        }

        const word = await prisma.word.create({
            data: {
                wordText: data.wordText,
                difficulty: data.difficulty,
                locale: data.locale,
                tabooWords: {
                    create: data.tabooWords.map((tw) => ({ tabooWordText: tw })),
                },
                wordCategories: normalizedCategoryIds.length > 0
                    ? {
                        create: normalizedCategoryIds.map((catId) => ({
                            categoryId: catId,
                        })),
                    }
                    : undefined,
            },
            include: {
                tabooWords: true,
                wordCategories: { include: { category: true } },
            },
        });
        await invalidateAdminDashboardStatsCache();

        return NextResponse.json(word, {
            status: 201,
            headers: buildRateLimitHeaders(rateLimit),
        });
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
        console.error("Failed to create word:", error);
        return NextResponse.json(
            { error: "Kelime oluşturulamadı." },
            { status: 500 }
        );
    }
}
