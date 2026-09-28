import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { requireAdminSession } from "@/lib/admin/require-admin";
import { grantAdminInventoryItem } from "@/lib/admin-inventory-operations/service";
import { writeAuditLog } from "@/lib/security/audit-log";
import {
    buildRateLimitHeaders,
    consumeRequestRateLimit,
    getRequestIp,
} from "@/lib/security/request-rate-limit";

export const dynamic = "force-dynamic";

const routeParamsSchema = z.object({
    id: z.coerce.number().int().min(1),
});

const grantSchema = z.object({
    shopItemId: z.coerce.number().int().min(1),
    reason: z.string().trim().min(3).max(240),
});

export async function POST(
    request: NextRequest,
    context: { params: Promise<{ id: string }> }
) {
    const adminSession = await requireAdminSession();
    if (adminSession instanceof NextResponse) {
        return adminSession;
    }

    const parsedParams = routeParamsSchema.safeParse(await context.params);
    if (!parsedParams.success) {
        return NextResponse.json({ error: "Geçersiz kullanıcı." }, { status: 422 });
    }

    try {
        const rateLimit = consumeRequestRateLimit({
            bucket: "admin-inventory-grant",
            key: `admin:${adminSession.id}:${getRequestIp(request)}`,
            windowMs: 60_000,
            maxRequests: 30,
        });
        if (!rateLimit.allowed) {
            return NextResponse.json(
                { error: "Çok fazla grant denemesi. Lütfen biraz bekleyin." },
                { status: 429, headers: buildRateLimitHeaders(rateLimit) }
            );
        }

        const body = await request.json();
        const parsedBody = grantSchema.parse(body);

        const result = await grantAdminInventoryItem({
            targetUserId: parsedParams.data.id,
            shopItemId: parsedBody.shopItemId,
            reason: parsedBody.reason,
        });

        if (!result) {
            return NextResponse.json({ error: "Kullanıcı veya item bulunamadı." }, { status: 404 });
        }
        if (result === "already_owned") {
            return NextResponse.json({ error: "Oyuncu bu item'a zaten sahip." }, { status: 409 });
        }

        await writeAuditLog({
            actor: adminSession,
            action: "admin.inventory.grant",
            resourceType: "inventory_item",
            resourceId: result.inventoryItemId,
            summary: `Granted ${result.shopItemName} to ${result.targetUsername}`,
            metadata: {
                targetUserId: result.targetUserId,
                targetUsername: result.targetUsername,
                shopItemId: result.shopItemId,
                shopItemName: result.shopItemName,
                inventoryItemSource: result.inventoryItemSource,
                reason: parsedBody.reason,
            },
            request,
        });

        return NextResponse.json(result, { status: 201 });
    } catch (error) {
        if (error instanceof z.ZodError) {
            return NextResponse.json({ error: error.issues[0]?.message || "Geçersiz grant verisi." }, { status: 422 });
        }

        console.error("Failed to grant inventory item:", error);
        return NextResponse.json({ error: "Item grant işlemi tamamlanamadı." }, { status: 500 });
    }
}
