import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { getSessionUser } from "@/lib/session";
import {
    buildRateLimitHeaders,
    consumeDistributedRequestRateLimit,
    getRequestIp,
} from "@/lib/security/request-rate-limit";
import { writeAuditLog } from "@/lib/security/audit-log";
import { supportTicketReplySchema } from "@/lib/support/schema";
import { addSupportReplyForUser, SupportDeskWorkflowError } from "@/lib/support/service";

export const dynamic = "force-dynamic";

const paramsSchema = z.object({
    id: z.coerce.number().int().min(1),
});

export async function POST(
    request: NextRequest,
    context: { params: Promise<{ id: string }> }
) {
    const sessionUser = await getSessionUser();
    if (!sessionUser) {
        return NextResponse.json({ error: "Giris gerekli." }, { status: 401 });
    }

    const params = paramsSchema.safeParse(await context.params);
    if (!params.success) {
        return NextResponse.json({ error: "Gecersiz destek talebi." }, { status: 422 });
    }

    const rateLimit = await consumeDistributedRequestRateLimit({
        bucket: "support-ticket-reply",
        key: `user:${sessionUser.id}:${getRequestIp(request)}`,
        windowMs: 60 * 60 * 1000,
        maxRequests: 20,
    });
    if (!rateLimit.allowed) {
        return NextResponse.json(
            { error: "Cok fazla destek mesaji gonderildi. Lutfen biraz bekleyin." },
            { status: 429, headers: buildRateLimitHeaders(rateLimit) }
        );
    }

    try {
        const body = await request.json();
        const input = supportTicketReplySchema.parse(body);
        const ticket = await addSupportReplyForUser(params.data.id, sessionUser.id, input);

        await writeAuditLog({
            actor: sessionUser,
            action: "user.support_ticket.reply",
            resourceType: "support_ticket",
            resourceId: ticket.id,
            summary: `replied to support ticket ${ticket.id}`,
            metadata: {
                status: ticket.status,
            },
            request,
        });

        return NextResponse.json(ticket);
    } catch (error) {
        if (error instanceof SupportDeskWorkflowError) {
            const messages: Record<string, string> = {
                ticket_not_found: "Destek talebi bulunamadi.",
                forbidden: "Bu talebe erisim yetkin yok.",
                ticket_closed: "Cozuldu veya kapatildi durumundaki talebe yeni mesaj eklenemez.",
                invalid_assignee: "Gecersiz islem.",
                reply_cooldown: `Cok hizli mesaj gonderiyorsun. Lutfen ${error.retryAfterSeconds ?? 30} saniye bekle.`,
            };
            const status =
                error.code === "ticket_not_found"
                    ? 404
                    : error.code === "forbidden"
                      ? 403
                      : error.code === "reply_cooldown"
                        ? 429
                      : 409;
            return NextResponse.json(
                { error: messages[error.code] },
                {
                    status,
                    headers:
                        error.code === "reply_cooldown" && error.retryAfterSeconds
                            ? { "Retry-After": String(error.retryAfterSeconds) }
                            : undefined,
                }
            );
        }

        if (error instanceof z.ZodError) {
            return NextResponse.json(
                { error: error.issues[0]?.message || "Gecersiz destek mesaji." },
                { status: 422 }
            );
        }

        console.error("Failed to reply support ticket:", error);
        return NextResponse.json({ error: "Destek mesaji gonderilemedi." }, { status: 500 });
    }
}
