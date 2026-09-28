import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { requireAdminSession } from "@/lib/admin/require-admin";
import { supportTicketAdminUpdateSchema } from "@/lib/support/schema";
import { SupportDeskWorkflowError, updateSupportTicketByAdmin } from "@/lib/support/service";
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

export async function PATCH(
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
        bucket: "admin-support-ticket-update",
        key: `admin:${adminSession.id}:${getRequestIp(request)}`,
        windowMs: 60_000,
        maxRequests: 40,
    });
    if (!rateLimit.allowed) {
        return NextResponse.json(
            { error: "Cok fazla destek guncelleme denemesi. Lutfen biraz bekleyin." },
            { status: 429, headers: buildRateLimitHeaders(rateLimit) }
        );
    }

    try {
        const body = await request.json();
        const input = supportTicketAdminUpdateSchema.parse(body);
        const ticket = await updateSupportTicketByAdmin(params.data.id, input);

        await writeAuditLog({
            actor: adminSession,
            action: "admin.support_ticket.update",
            resourceType: "support_ticket",
            resourceId: ticket.id,
            summary: `updated support ticket ${ticket.id}`,
            metadata: {
                status: ticket.status,
                priority: ticket.priority,
                assignedAdminUserId: ticket.assignedAdmin?.id ?? null,
            },
            request,
        });

        return NextResponse.json(ticket);
    } catch (error) {
        if (error instanceof SupportDeskWorkflowError) {
            const messages: Record<string, string> = {
                ticket_not_found: "Destek talebi bulunamadi.",
                forbidden: "Bu talep icin yetkin yok.",
                ticket_closed: "Kapali talep bu islem icin uygun degil.",
                invalid_assignee: "Secilen admin atanamaz.",
            };
            const status = error.code === "ticket_not_found" ? 404 : 409;
            return NextResponse.json({ error: messages[error.code] }, { status });
        }

        if (error instanceof z.ZodError) {
            return NextResponse.json(
                { error: error.issues[0]?.message || "Gecersiz destek guncellemesi." },
                { status: 422 }
            );
        }

        console.error("Failed to update support ticket:", error);
        return NextResponse.json({ error: "Destek talebi guncellenemedi." }, { status: 500 });
    }
}

