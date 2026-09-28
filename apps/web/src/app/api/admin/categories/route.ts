import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { z } from "zod";
import { invalidateCategoryCache } from "@/lib/socket/category-service";
import { validateAdminCategoryInput } from "@/lib/categories/admin-category-policy";
import { requireAdminSession } from "@/lib/admin/require-admin";
import {
    buildRateLimitHeaders,
    consumeRequestRateLimit,
    getRequestIp,
} from "@/lib/security/request-rate-limit";
import {
    DEFAULT_GAME_CONTENT_LOCALE,
    GAME_CONTENT_LOCALES,
    normalizeGameContentLocale,
} from "@hushle/domain-game";

export const dynamic = "force-dynamic";

export async function GET(request: NextRequest) {
    const adminSession = await requireAdminSession();
    if (adminSession instanceof NextResponse) {
        return adminSession;
    }

    const rateLimit = consumeRequestRateLimit({
        bucket: "admin-categories-read",
        key: `${adminSession.id}:${getRequestIp(request)}`,
        windowMs: 60_000,
        maxRequests: 90,
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

    const locale = normalizeGameContentLocale(
        request.nextUrl.searchParams.get("locale")
    );
    const categories = await prisma.category.findMany({
        orderBy: { sortOrder: "asc" },
        include: {
            children: {
                orderBy: { sortOrder: "asc" },
                include: {
                    _count: { select: { wordCategories: true } },
                },
            },
            _count: { select: { wordCategories: true } },
        },
        where: {
            parentId: null,
            locale,
        },
    });

    return NextResponse.json(categories, {
        headers: buildRateLimitHeaders(rateLimit),
    });
}

const createCategorySchema = z.object({
    name: z.string().min(1).max(255),
    parentId: z.number().nullable().optional(),
    color: z.string().max(7).nullable().optional(),
    sortOrder: z.number().optional(),
    isVisible: z.boolean().optional(),
    locale: z.enum(GAME_CONTENT_LOCALES).default(DEFAULT_GAME_CONTENT_LOCALE),
});

export async function POST(request: NextRequest) {
    const adminSession = await requireAdminSession();
    if (adminSession instanceof NextResponse) {
        return adminSession;
    }

    const rateLimit = consumeRequestRateLimit({
        bucket: "admin-categories-write",
        key: `${adminSession.id}:${getRequestIp(request)}`,
        windowMs: 60_000,
        maxRequests: 30,
    });
    if (!rateLimit.allowed) {
        return NextResponse.json(
            { error: "Cok fazla kategori olusturma denemesi. Lutfen biraz bekleyin." },
            { status: 429, headers: buildRateLimitHeaders(rateLimit) }
        );
    }

    try {
        const body = await request.json();
        const parsed = createCategorySchema.parse(body);
        const data = await validateAdminCategoryInput(parsed);

        const category = await prisma.category.create({
            data: {
                name: data.name!,
                parentId: data.parentId ?? null,
                color: data.color ?? null,
                sortOrder: data.sortOrder ?? 0,
                isVisible: data.isVisible ?? true,
                locale: data.locale ?? "tr",
            },
        });

        await invalidateCategoryCache();
        return NextResponse.json(category, {
            status: 201,
            headers: buildRateLimitHeaders(rateLimit),
        });
    } catch (error) {
        if (error instanceof z.ZodError) {
            return NextResponse.json(
                { error: "Gecersiz veri.", details: error.issues },
                { status: 400 }
            );
        }
        if (error instanceof Error) {
            return NextResponse.json(
                { error: error.message },
                { status: 400 }
            );
        }
        console.error("Failed to create category:", error);
        return NextResponse.json(
            { error: "Kategori olusturulamadi." },
            { status: 500 }
        );
    }
}
