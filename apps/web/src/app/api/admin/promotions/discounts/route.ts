import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { prisma } from "@/lib/prisma";
import { requireAdminSession } from "@/lib/admin/require-admin";
import { invalidateStoreCatalogCache } from "@/lib/cache/application-cache";
import {
    discountCampaignWriteSchema,
    toPrismaDiscountCampaignCreateData,
} from "@/lib/promotions/promotion-schema";
import { writeAuditLog } from "@/lib/security/audit-log";
import {
    buildRateLimitHeaders,
    consumeRequestRateLimit,
    getRequestIp,
} from "@/lib/security/request-rate-limit";

export const dynamic = "force-dynamic";

export async function GET(request: NextRequest) {
    const adminSession = await requireAdminSession();
    if (adminSession instanceof NextResponse) {
        return adminSession;
    }

    const rateLimit = consumeRequestRateLimit({
        bucket: "admin-discounts-read",
        key: `admin:${adminSession.id}:${getRequestIp(request)}`,
        windowMs: 60_000,
        maxRequests: 90,
    });
    if (!rateLimit.allowed) {
        return NextResponse.json(
            { error: "Cok fazla kampanya listeleme istegi. Lutfen biraz bekleyin." },
            { status: 429, headers: buildRateLimitHeaders(rateLimit) }
        );
    }

    const discounts = await prisma.discountCampaign.findMany({
        orderBy: [{ isActive: "desc" }, { createdAt: "desc" }],
    });

    return NextResponse.json(
        discounts.map((discount) => ({
            ...discount,
            startsAt: discount.startsAt?.toISOString() ?? null,
            endsAt: discount.endsAt?.toISOString() ?? null,
            createdAt: discount.createdAt.toISOString(),
        })),
        { headers: buildRateLimitHeaders(rateLimit) }
    );
}

export async function POST(request: NextRequest) {
    const adminSession = await requireAdminSession();
    if (adminSession instanceof NextResponse) {
        return adminSession;
    }

    const rateLimit = consumeRequestRateLimit({
        bucket: "admin-discounts-write",
        key: `admin:${adminSession.id}:${getRequestIp(request)}`,
        windowMs: 60_000,
        maxRequests: 30,
    });
    if (!rateLimit.allowed) {
        return NextResponse.json(
            { error: "Cok fazla kampanya olusturma denemesi. Lutfen biraz bekleyin." },
            { status: 429, headers: buildRateLimitHeaders(rateLimit) }
        );
    }

    try {
        const body = await request.json();
        const parsed = discountCampaignWriteSchema.parse(body);
        const discount = await prisma.discountCampaign.create({
            data: toPrismaDiscountCampaignCreateData(parsed),
        });
        await invalidateStoreCatalogCache();
        await writeAuditLog({
            actor: adminSession,
            action: "admin.discount.create",
            resourceType: "discount_campaign",
            resourceId: discount.id,
            summary: `Created discount ${discount.code}`,
            metadata: {
                code: discount.code,
                targetType: discount.targetType,
                usageLimit: discount.usageLimit,
            },
            request,
        });

        return NextResponse.json(
            {
                ...discount,
                startsAt: discount.startsAt?.toISOString() ?? null,
                endsAt: discount.endsAt?.toISOString() ?? null,
                createdAt: discount.createdAt.toISOString(),
            },
            {
                status: 201,
                headers: buildRateLimitHeaders(rateLimit),
            }
        );
    } catch (error) {
        if (error instanceof z.ZodError) {
            return NextResponse.json({ error: "Gecersiz veri.", details: error.issues }, { status: 400 });
        }
        if (typeof error === "object" && error !== null && "code" in error && (error as { code?: string }).code === "P2002") {
            return NextResponse.json({ error: "Bu kampanya kodu zaten kullanılıyor. Farklı bir kod gir." }, { status: 409 });
        }

        console.error("Failed to create discount campaign:", error);
        return NextResponse.json({ error: "Indirim kampanyasi olusturulamadi." }, { status: 500 });
    }
}
