import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { prisma } from "@/lib/prisma";
import { requireAdminSession } from "@/lib/admin/require-admin";
import { invalidateStoreCatalogCache } from "@/lib/cache/application-cache";
import {
    discountCampaignUpdateSchema,
    toPrismaDiscountCampaignUpdateData,
} from "@/lib/promotions/promotion-schema";
import { writeAuditLog } from "@/lib/security/audit-log";
import {
    buildRateLimitHeaders,
    consumeRequestRateLimit,
    getRequestIp,
} from "@/lib/security/request-rate-limit";

export const dynamic = "force-dynamic";

export async function GET(
    request: NextRequest,
    { params }: { params: Promise<{ id: string }> }
) {
    const adminSession = await requireAdminSession();
    if (adminSession instanceof NextResponse) {
        return adminSession;
    }

    const rateLimit = consumeRequestRateLimit({
        bucket: "admin-discount-read",
        key: `admin:${adminSession.id}:${getRequestIp(request)}`,
        windowMs: 60_000,
        maxRequests: 120,
    });
    if (!rateLimit.allowed) {
        return NextResponse.json(
            { error: "Cok fazla kampanya detay istegi. Lutfen biraz bekleyin." },
            { status: 429, headers: buildRateLimitHeaders(rateLimit) }
        );
    }

    const { id } = await params;
    const discountId = Number(id);
    if (!Number.isInteger(discountId) || discountId <= 0) {
        return NextResponse.json({ error: "Gecersiz indirim id." }, { status: 400 });
    }

    const discount = await prisma.discountCampaign.findUnique({
        where: { id: discountId },
    });

    if (!discount) {
        return NextResponse.json({ error: "Indirim bulunamadi." }, { status: 404 });
    }

    return NextResponse.json(
        {
            ...discount,
            startsAt: discount.startsAt?.toISOString() ?? null,
            endsAt: discount.endsAt?.toISOString() ?? null,
            createdAt: discount.createdAt.toISOString(),
        },
        { headers: buildRateLimitHeaders(rateLimit) }
    );
}

export async function PUT(
    request: NextRequest,
    { params }: { params: Promise<{ id: string }> }
) {
    const adminSession = await requireAdminSession();
    if (adminSession instanceof NextResponse) {
        return adminSession;
    }

    const rateLimit = consumeRequestRateLimit({
        bucket: "admin-discount-update",
        key: `admin:${adminSession.id}:${getRequestIp(request)}`,
        windowMs: 60_000,
        maxRequests: 30,
    });
    if (!rateLimit.allowed) {
        return NextResponse.json(
            { error: "Cok fazla kampanya guncelleme denemesi. Lutfen biraz bekleyin." },
            { status: 429, headers: buildRateLimitHeaders(rateLimit) }
        );
    }

    try {
        const { id } = await params;
        const discountId = Number(id);
        if (!Number.isInteger(discountId) || discountId <= 0) {
            return NextResponse.json({ error: "Gecersiz indirim id." }, { status: 400 });
        }

        const body = await request.json();
        const parsed = discountCampaignUpdateSchema.parse(body);
        const discount = await prisma.discountCampaign.update({
            where: { id: discountId },
            data: toPrismaDiscountCampaignUpdateData(parsed),
        });
        await invalidateStoreCatalogCache();
        await writeAuditLog({
            actor: adminSession,
            action: "admin.discount.update",
            resourceType: "discount_campaign",
            resourceId: discount.id,
            summary: `Updated discount ${discount.code}`,
            metadata: {
                isActive: discount.isActive,
                usageLimit: discount.usageLimit,
                usedCount: discount.usedCount,
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
            { headers: buildRateLimitHeaders(rateLimit) }
        );
    } catch (error) {
        if (error instanceof z.ZodError) {
            return NextResponse.json({ error: "Gecersiz veri.", details: error.issues }, { status: 400 });
        }
        if (typeof error === "object" && error !== null && "code" in error && (error as { code?: string }).code === "P2002") {
            return NextResponse.json({ error: "Bu kampanya kodu zaten kullanılıyor. Farklı bir kod gir." }, { status: 409 });
        }

        console.error("Failed to update discount campaign:", error);
        return NextResponse.json({ error: "Indirim kampanyasi guncellenemedi." }, { status: 500 });
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
        bucket: "admin-discount-delete",
        key: `admin:${adminSession.id}:${getRequestIp(request)}`,
        windowMs: 60_000,
        maxRequests: 20,
    });
    if (!rateLimit.allowed) {
        return NextResponse.json(
            { error: "Cok fazla kampanya pasife alma veya silme denemesi. Lutfen biraz bekleyin." },
            { status: 429, headers: buildRateLimitHeaders(rateLimit) }
        );
    }

    try {
        const { id } = await params;
        const discountId = Number(id);
        if (!Number.isInteger(discountId) || discountId <= 0) {
            return NextResponse.json({ error: "Gecersiz indirim id." }, { status: 400 });
        }

        const discount = await prisma.discountCampaign.findUnique({
            where: { id: discountId },
            select: {
                id: true,
                code: true,
                isActive: true,
                usedCount: true,
            },
        });
        if (!discount) {
            return NextResponse.json({ error: "İndirim bulunamadı." }, { status: 404 });
        }

        let outcome: "deleted" | "deactivated" = "deactivated";
        if (discount.isActive) {
            await prisma.discountCampaign.update({
                where: { id: discountId },
                data: { isActive: false },
            });
        } else {
            if (discount.usedCount > 0) {
                return NextResponse.json(
                    { error: "Kullanılmış kampanya kalıcı olarak silinemez. Pasif halde bırakılmalı." },
                    { status: 409 }
                );
            }

            await prisma.discountCampaign.delete({
                where: { id: discountId },
            });
            outcome = "deleted";
        }
        await invalidateStoreCatalogCache();
        await writeAuditLog({
            actor: adminSession,
            action: outcome === "deleted" ? "admin.discount.delete" : "admin.discount.deactivate",
            resourceType: "discount_campaign",
            resourceId: discountId,
            summary: outcome === "deleted" ? `Deleted discount ${discount.code}` : `Disabled discount ${discount.code}`,
            request,
        });

        return NextResponse.json({ success: true, outcome }, { headers: buildRateLimitHeaders(rateLimit) });
    } catch (error) {
        console.error("Failed to delete discount campaign:", error);
        return NextResponse.json({ error: "Indirim kampanyasi silinemedi." }, { status: 500 });
    }
}
