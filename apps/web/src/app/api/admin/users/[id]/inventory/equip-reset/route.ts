import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { requireAdminSession } from "@/lib/admin/require-admin";
import { resetAdminInventoryEquipSlot } from "@/lib/admin-inventory-operations/service";
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

const resetSchema = z.object({
    slot: z.enum(["avatar", "frame", "card_back", "card_face"]),
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
            bucket: "admin-inventory-equip-reset",
            key: `admin:${adminSession.id}:${getRequestIp(request)}`,
            windowMs: 60_000,
            maxRequests: 30,
        });
        if (!rateLimit.allowed) {
            return NextResponse.json(
                { error: "Çok fazla equip reset denemesi. Lütfen biraz bekleyin." },
                { status: 429, headers: buildRateLimitHeaders(rateLimit) }
            );
        }

        const body = await request.json();
        const parsedBody = resetSchema.parse(body);

        const result = await resetAdminInventoryEquipSlot({
            targetUserId: parsedParams.data.id,
            slot: parsedBody.slot,
        });
        if (!result) {
            return NextResponse.json({ error: "Kullanıcı bulunamadı." }, { status: 404 });
        }

        if (!result.alreadyEmpty) {
            await writeAuditLog({
                actor: adminSession,
                action: "admin.inventory.equip_reset",
                resourceType: "user_profile",
                resourceId: result.targetUserId,
                summary: `Reset ${result.slot} slot for ${result.targetUsername}`,
                metadata: {
                    targetUserId: result.targetUserId,
                    targetUsername: result.targetUsername,
                    slot: result.slot,
                    clearedShopItemId: result.clearedShopItemId,
                    clearedShopItemName: result.clearedShopItemName,
                },
                request,
            });
        }

        return NextResponse.json({ ok: true, ...result });
    } catch (error) {
        if (error instanceof z.ZodError) {
            return NextResponse.json({ error: error.issues[0]?.message || "Geçersiz equip reset verisi." }, { status: 422 });
        }

        console.error("Failed to reset equipped inventory slot:", error);
        return NextResponse.json({ error: "Equip reset işlemi tamamlanamadı." }, { status: 500 });
    }
}
