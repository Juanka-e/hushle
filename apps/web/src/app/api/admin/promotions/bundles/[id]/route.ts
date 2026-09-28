import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { prisma } from "@/lib/prisma";
import { requireAdminSession } from "@/lib/admin/require-admin";
import { invalidateStoreCatalogCache } from "@/lib/cache/application-cache";
import {
    bundleUpdateSchema,
    toPrismaBundleUpdateData,
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
        bucket: "admin-bundle-read",
        key: `admin:${adminSession.id}:${getRequestIp(request)}`,
        windowMs: 60_000,
        maxRequests: 120,
    });
    if (!rateLimit.allowed) {
        return NextResponse.json(
            { error: "Cok fazla paket detay istegi. Lutfen biraz bekleyin." },
            { status: 429, headers: buildRateLimitHeaders(rateLimit) }
        );
    }

    const { id } = await params;
    const bundleId = Number(id);
    if (!Number.isInteger(bundleId) || bundleId <= 0) {
        return NextResponse.json({ error: "Gecersiz bundle id." }, { status: 400 });
    }

    const bundle = await prisma.shopBundle.findUnique({
        where: { id: bundleId },
        include: {
            items: {
                orderBy: [{ sortOrder: "asc" }, { createdAt: "asc" }],
                include: {
                    shopItem: {
                        select: {
                            code: true,
                            name: true,
                            type: true,
                            rarity: true,
                        },
                    },
                },
            },
        },
    });

    if (!bundle) {
        return NextResponse.json({ error: "Bundle bulunamadi." }, { status: 404 });
    }

    return NextResponse.json(bundle, { headers: buildRateLimitHeaders(rateLimit) });
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
        bucket: "admin-bundle-update",
        key: `admin:${adminSession.id}:${getRequestIp(request)}`,
        windowMs: 60_000,
        maxRequests: 30,
    });
    if (!rateLimit.allowed) {
        return NextResponse.json(
            { error: "Cok fazla paket guncelleme denemesi. Lutfen biraz bekleyin." },
            { status: 429, headers: buildRateLimitHeaders(rateLimit) }
        );
    }

    try {
        const { id } = await params;
        const bundleId = Number(id);
        if (!Number.isInteger(bundleId) || bundleId <= 0) {
            return NextResponse.json({ error: "Gecersiz bundle id." }, { status: 400 });
        }

        const body = await request.json();
        const parsed = bundleUpdateSchema.parse(body);

        const bundle = await prisma.$transaction(async (tx) => {
            const updatedBundle = await tx.shopBundle.update({
                where: { id: bundleId },
                data: toPrismaBundleUpdateData(parsed),
            });

            if (parsed.items) {
                await tx.shopBundleItem.deleteMany({ where: { bundleId } });
                await tx.shopBundleItem.createMany({
                    data: parsed.items.map((item) => ({
                        bundleId,
                        shopItemId: item.shopItemId,
                        sortOrder: item.sortOrder,
                    })),
                });
            }

            return tx.shopBundle.findUnique({
                where: { id: updatedBundle.id },
                include: {
                    items: {
                        orderBy: [{ sortOrder: "asc" }, { createdAt: "asc" }],
                        include: {
                            shopItem: {
                                select: {
                                    code: true,
                                    name: true,
                                    type: true,
                                    rarity: true,
                                },
                            },
                        },
                    },
                },
            });
        });
        await invalidateStoreCatalogCache();
        if (bundle) {
            await writeAuditLog({
                actor: adminSession,
                action: "admin.bundle.update",
                resourceType: "shop_bundle",
                resourceId: bundle.id,
                summary: `Updated bundle ${bundle.code}`,
                metadata: {
                    isActive: bundle.isActive,
                    priceCoin: bundle.priceCoin,
                    itemCount: bundle.items.length,
                },
                request,
            });
        }

        return NextResponse.json(bundle, { headers: buildRateLimitHeaders(rateLimit) });
    } catch (error) {
        if (error instanceof z.ZodError) {
            return NextResponse.json({ error: "Gecersiz veri.", details: error.issues }, { status: 400 });
        }
        if (typeof error === "object" && error !== null && "code" in error && (error as { code?: string }).code === "P2002") {
            return NextResponse.json({ error: "Bu paket kodu zaten kullanılıyor. Farklı bir kod gir." }, { status: 409 });
        }

        console.error("Failed to update shop bundle:", error);
        return NextResponse.json({ error: "Bundle guncellenemedi." }, { status: 500 });
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
        bucket: "admin-bundle-delete",
        key: `admin:${adminSession.id}:${getRequestIp(request)}`,
        windowMs: 60_000,
        maxRequests: 20,
    });
    if (!rateLimit.allowed) {
        return NextResponse.json(
            { error: "Cok fazla paket pasife alma veya silme denemesi. Lutfen biraz bekleyin." },
            { status: 429, headers: buildRateLimitHeaders(rateLimit) }
        );
    }

    try {
        const { id } = await params;
        const bundleId = Number(id);
        if (!Number.isInteger(bundleId) || bundleId <= 0) {
            return NextResponse.json({ error: "Gecersiz bundle id." }, { status: 400 });
        }

        const bundle = await prisma.shopBundle.findUnique({
            where: { id: bundleId },
            select: {
                id: true,
                code: true,
                isActive: true,
                _count: {
                    select: {
                        purchases: true,
                        discountCampaigns: true,
                        couponCodes: true,
                    },
                },
            },
        });
        if (!bundle) {
            return NextResponse.json({ error: "Paket bulunamadı." }, { status: 404 });
        }

        let outcome: "deleted" | "deactivated" = "deactivated";
        if (bundle.isActive) {
            await prisma.shopBundle.update({
                where: { id: bundleId },
                data: { isActive: false },
            });
        } else {
            if (
                bundle._count.purchases > 0 ||
                bundle._count.discountCampaigns > 0 ||
                bundle._count.couponCodes > 0
            ) {
                return NextResponse.json(
                    { error: "Kullanılmış veya başka promosyonlara bağlı paket kalıcı olarak silinemez." },
                    { status: 409 }
                );
            }

            await prisma.shopBundle.delete({
                where: { id: bundleId },
            });
            outcome = "deleted";
        }
        await invalidateStoreCatalogCache();
        await writeAuditLog({
            actor: adminSession,
            action: outcome === "deleted" ? "admin.bundle.delete" : "admin.bundle.deactivate",
            resourceType: "shop_bundle",
            resourceId: bundleId,
            summary: outcome === "deleted" ? `Deleted bundle ${bundle.code}` : `Disabled bundle ${bundle.code}`,
            request,
        });

        return NextResponse.json({ success: true, outcome }, { headers: buildRateLimitHeaders(rateLimit) });
    } catch (error) {
        console.error("Failed to delete shop bundle:", error);
        return NextResponse.json({ error: "Bundle silinemedi." }, { status: 500 });
    }
}
