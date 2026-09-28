import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { requireAdminSession } from "@/lib/admin/require-admin";
import { supportTicketAdminMessageSchema } from "@/lib/support/schema";
import { addSupportMessageByAdmin, SupportDeskWorkflowError } from "@/lib/support/service";
import { writeAuditLog } from "@/lib/security/audit-log";
import {
    buildRateLimitHeaders,
    consumeRequestRateLimit,
    getRequestIp,
} from "@/lib/security/request-rate-limit";

export const dynamic = "force-dynamic";

const paramsSchema = z.object({
    id: z.coerce.number().int().min(1),
});

export async function POST(
    request: NextRequest,
    context: { params: Promise<{ id: string }> }
) {
    const adminSession = await requireAdminSession();
    if (adminSession instanceof NextResponse) {
        return adminSession;
    }

    const params = paramsSchema.safeParse(await context.params);
    if (!params.success) {
        return NextResponse.json({ error: "Gecersiz destek talebi." }, { status: 422 });
    }

    const rateLimit = consumeRequestRateLimit({
        bucket: "admin-support-ticket-message",
        key: `admin:${adminSession.id}:${getRequestIp(request)}`,
        windowMs: 60_000,
        maxRequests: 50,
    });
    if (!rateLimit.allowed) {
        return NextResponse.json(
            { error: "Cok fazla destek mesaji gonderildi. Lutfen biraz bekleyin." },
            { status: 429, headers: buildRateLimitHeaders(rateLimit) }
        );
    }

    try {
        const body = await request.json();
        const input = supportTicketAdminMessageSchema.parse(body);
        const ticket = await addSupportMessageByAdmin(params.data.id, adminSession.id, input);

        await writeAuditLog({
            actor: adminSession,
            action: input.isInternal ? "admin.support_ticket.note" : "admin.support_ticket.reply",
            resourceType: "support_ticket",
            resourceId: ticket.id,
            summary: `${input.isInternal ? "added internal note to" : "replied to"} support ticket ${ticket.id}`,
            metadata: {
                status: ticket.status,
                isInternal: input.isInternal,
            },
            request,
        });

        return NextResponse.json(ticket);
    } catch (error) {
        if (error instanceof SupportDeskWorkflowError) {
            const messages: Record<string, string> = {
                ticket_not_found: "Destek talebi bulunamadi.",
                forbidden: "Bu talep icin yetkin yok.",
                ticket_closed: "Kapali destek talebine yeni mesaj eklenemez.",
                invalid_assignee: "Gecersiz islem.",
            };
            const status = error.code === "ticket_not_found" ? 404 : 409;
            return NextResponse.json({ error: messages[error.code] }, { status });
        }

        if (error instanceof z.ZodError) {
            return NextResponse.json(
                { error: error.issues[0]?.message || "Gecersiz destek mesaji." },
                { status: 422 }
            );
        }

        console.error("Failed to create support admin message:", error);
        return NextResponse.json({ error: "Destek mesaji eklenemedi." }, { status: 500 });
    }
}

