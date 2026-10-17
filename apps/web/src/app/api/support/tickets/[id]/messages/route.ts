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
import { PlayerErrorCode, playerError, playerErrorFromValidation } from "@/lib/errors/player-error";

export const dynamic = "force-dynamic";

const SUPPORT_WORKFLOW_ERROR_CODES: Record<SupportDeskWorkflowError["code"], PlayerErrorCode> = {
    ticket_not_found: PlayerErrorCode.SUPPORT_TICKET_NOT_FOUND,
    forbidden: PlayerErrorCode.SUPPORT_TICKET_FORBIDDEN,
    ticket_closed: PlayerErrorCode.SUPPORT_TICKET_CLOSED,
    invalid_assignee: PlayerErrorCode.INVALID_REQUEST,
    reply_cooldown: PlayerErrorCode.SUPPORT_REPLY_COOLDOWN,
};

const paramsSchema = z.object({
    id: z.coerce.number().int().min(1),
});

export async function POST(
    request: NextRequest,
    context: { params: Promise<{ id: string }> }
) {
    const sessionUser = await getSessionUser();
    if (!sessionUser) {
        return NextResponse.json(playerError(PlayerErrorCode.AUTH_REQUIRED), { status: 401 });
    }

    const params = paramsSchema.safeParse(await context.params);
    if (!params.success) {
        return NextResponse.json(playerError(PlayerErrorCode.INVALID_REQUEST), { status: 422 });
    }

    const rateLimit = await consumeDistributedRequestRateLimit({
        bucket: "support-ticket-reply",
        key: `user:${sessionUser.id}:${getRequestIp(request)}`,
        windowMs: 60 * 60 * 1000,
        maxRequests: 20,
    });
    if (!rateLimit.allowed) {
        return NextResponse.json(
            playerError(PlayerErrorCode.RATE_LIMITED),
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
            const status =
                error.code === "ticket_not_found"
                    ? 404
                    : error.code === "forbidden"
                      ? 403
                      : error.code === "reply_cooldown"
                        ? 429
                      : 409;
            return NextResponse.json(
                playerError(
                    SUPPORT_WORKFLOW_ERROR_CODES[error.code],
                    error.code === "reply_cooldown"
                        ? { seconds: error.retryAfterSeconds ?? 30 }
                        : undefined
                ),
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
                playerErrorFromValidation(error, { body: PlayerErrorCode.SUPPORT_MESSAGE_INVALID }),
                { status: 422 }
            );
        }

        console.error("Failed to reply support ticket:", error);
        return NextResponse.json(playerError(PlayerErrorCode.SUPPORT_REPLY_FAILED), { status: 500 });
    }
}
