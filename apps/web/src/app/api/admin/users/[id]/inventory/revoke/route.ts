import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { requireAdminSession } from "@/lib/admin/require-admin";
import { revokeAdminInventoryItem } from "@/lib/admin-inventory-operations/service";
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

const revokeSchema = z.object({
    inventoryItemId: z.coerce.number().int().min(1),
    reason: z.string().trim().min(3).max(240),
    overrideProtectedSource: z.boolean().optional().default(false),
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
            bucket: "admin-inventory-revoke",
            key: `admin:${adminSession.id}:${getRequestIp(request)}`,
            windowMs: 60_000,
            maxRequests: 30,
        });
        if (!rateLimit.allowed) {
            return NextResponse.json(
                { error: "Çok fazla revoke denemesi. Lütfen biraz bekleyin." },
                { status: 429, headers: buildRateLimitHeaders(rateLimit) }
            );
        }

        const body = await request.json();
        const parsedBody = revokeSchema.parse(body);

        const result = await revokeAdminInventoryItem({
            targetUserId: parsedParams.data.id,
            inventoryItemId: parsedBody.inventoryItemId,
            reason: parsedBody.reason,
            overrideProtectedSource: parsedBody.overrideProtectedSource,
        });

        if (!result) {
            return NextResponse.json({ error: "Envanter kaydı bulunamadı." }, { status: 404 });
        }
        if (result === "protected_source") {
            return NextResponse.json(
                { error: "Satın alım veya migrasyon kaynaklı item'lar için ek onay gerekir." },
                { status: 409 }
            );
        }

        await writeAuditLog({
            actor: adminSession,
            action: "admin.inventory.revoke",
            resourceType: "inventory_item",
            resourceId: result.inventoryItemId,
            summary: `Revoked ${result.shopItemName} from ${result.targetUsername}`,
            metadata: {
                targetUserId: result.targetUserId,
                targetUsername: result.targetUsername,
                shopItemId: result.shopItemId,
                shopItemName: result.shopItemName,
                inventoryItemSource: result.inventoryItemSource,
                reason: parsedBody.reason,
                overrideProtectedSource: parsedBody.overrideProtectedSource,
            },
            request,
        });

        return NextResponse.json(result);
    } catch (error) {
        if (error instanceof z.ZodError) {
            return NextResponse.json({ error: error.issues[0]?.message || "Geçersiz revoke verisi." }, { status: 422 });
        }

        console.error("Failed to revoke inventory item:", error);
        return NextResponse.json({ error: "Item revoke işlemi tamamlanamadı." }, { status: 500 });
    }
}
