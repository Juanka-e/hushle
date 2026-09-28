import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { prisma } from "@/lib/prisma";
import { requireAdminSession } from "@/lib/admin/require-admin";
import { invalidateStoreCatalogCache } from "@/lib/cache/application-cache";
import {
    bundleWriteSchema,
    toPrismaBundleCreateData,
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
        bucket: "admin-bundles-read",
        key: `admin:${adminSession.id}:${getRequestIp(request)}`,
        windowMs: 60_000,
        maxRequests: 90,
    });
    if (!rateLimit.allowed) {
        return NextResponse.json(
            { error: "Cok fazla paket listeleme istegi. Lutfen biraz bekleyin." },
            { status: 429, headers: buildRateLimitHeaders(rateLimit) }
        );
    }

    const bundles = await prisma.shopBundle.findMany({
        orderBy: [{ sortOrder: "asc" }, { createdAt: "desc" }],
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

    return NextResponse.json(
        bundles.map((bundle) => ({
            id: bundle.id,
            code: bundle.code,
            name: bundle.name,
            description: bundle.description,
            priceCoin: bundle.priceCoin,
            isActive: bundle.isActive,
            sortOrder: bundle.sortOrder,
            createdAt: bundle.createdAt.toISOString(),
            items: bundle.items.map((item) => ({
                id: item.id,
                shopItemId: item.shopItemId,
                sortOrder: item.sortOrder,
                itemCode: item.shopItem.code,
                itemName: item.shopItem.name,
                itemType: item.shopItem.type,
                itemRarity: item.shopItem.rarity,
            })),
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
        bucket: "admin-bundles-write",
        key: `admin:${adminSession.id}:${getRequestIp(request)}`,
        windowMs: 60_000,
        maxRequests: 30,
    });
    if (!rateLimit.allowed) {
        return NextResponse.json(
            { error: "Cok fazla paket olusturma denemesi. Lutfen biraz bekleyin." },
            { status: 429, headers: buildRateLimitHeaders(rateLimit) }
        );
    }

    try {
        const body = await request.json();
        const parsed = bundleWriteSchema.parse(body);
        const bundle = await prisma.shopBundle.create({
            data: toPrismaBundleCreateData(parsed),
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
        await invalidateStoreCatalogCache();
        await writeAuditLog({
            actor: adminSession,
            action: "admin.bundle.create",
            resourceType: "shop_bundle",
            resourceId: bundle.id,
            summary: `Created bundle ${bundle.code}`,
            metadata: {
                code: bundle.code,
                priceCoin: bundle.priceCoin,
                itemCount: bundle.items.length,
            },
            request,
        });

        return NextResponse.json(bundle, {
            status: 201,
            headers: buildRateLimitHeaders(rateLimit),
        });
    } catch (error) {
        if (error instanceof z.ZodError) {
            return NextResponse.json({ error: "Gecersiz veri.", details: error.issues }, { status: 400 });
        }
        if (typeof error === "object" && error !== null && "code" in error && (error as { code?: string }).code === "P2002") {
            return NextResponse.json({ error: "Bu paket kodu zaten kullanılıyor. Farklı bir kod gir." }, { status: 409 });
        }

        console.error("Failed to create shop bundle:", error);
        return NextResponse.json({ error: "Bundle olusturulamadi." }, { status: 500 });
    }
}
