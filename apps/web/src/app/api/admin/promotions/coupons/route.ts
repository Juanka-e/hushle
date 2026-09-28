import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { prisma } from "@/lib/prisma";
import { requireAdminSession } from "@/lib/admin/require-admin";
import {
    couponCodeWriteSchema,
    toPrismaCouponCodeCreateData,
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
        bucket: "admin-coupons-read",
        key: `admin:${adminSession.id}:${getRequestIp(request)}`,
        windowMs: 60_000,
        maxRequests: 90,
    });
    if (!rateLimit.allowed) {
        return NextResponse.json(
            { error: "Cok fazla kupon listeleme istegi. Lutfen biraz bekleyin." },
            { status: 429, headers: buildRateLimitHeaders(rateLimit) }
        );
    }

    const coupons = await prisma.couponCode.findMany({
        orderBy: [{ isActive: "desc" }, { createdAt: "desc" }],
    });

    return NextResponse.json(
        coupons.map((coupon) => ({
            ...coupon,
            startsAt: coupon.startsAt?.toISOString() ?? null,
            endsAt: coupon.endsAt?.toISOString() ?? null,
            createdAt: coupon.createdAt.toISOString(),
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
        bucket: "admin-coupons-write",
        key: `admin:${adminSession.id}:${getRequestIp(request)}`,
        windowMs: 60_000,
        maxRequests: 30,
    });
    if (!rateLimit.allowed) {
        return NextResponse.json(
            { error: "Cok fazla kupon olusturma denemesi. Lutfen biraz bekleyin." },
            { status: 429, headers: buildRateLimitHeaders(rateLimit) }
        );
    }

    try {
        const body = await request.json();
        const parsed = couponCodeWriteSchema.parse(body);
        const coupon = await prisma.couponCode.create({
            data: toPrismaCouponCodeCreateData(parsed),
        });
        await writeAuditLog({
            actor: adminSession,
            action: "admin.coupon.create",
            resourceType: "coupon_code",
            resourceId: coupon.id,
            summary: `Created coupon ${coupon.code}`,
            metadata: {
                code: coupon.code,
                targetType: coupon.targetType,
                usageLimit: coupon.usageLimit,
            },
            request,
        });

        return NextResponse.json(coupon, {
            status: 201,
            headers: buildRateLimitHeaders(rateLimit),
        });
    } catch (error) {
        if (error instanceof z.ZodError) {
            return NextResponse.json({ error: "Gecersiz veri.", details: error.issues }, { status: 400 });
        }
        if (typeof error === "object" && error !== null && "code" in error && (error as { code?: string }).code === "P2002") {
            return NextResponse.json({ error: "Bu kupon kodu zaten kullanılıyor. Farklı bir kod gir." }, { status: 409 });
        }

        console.error("Failed to create coupon code:", error);
        return NextResponse.json({ error: "Kupon olusturulamadi." }, { status: 500 });
    }
}
