import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { requireAdminSession } from "@/lib/admin/require-admin";
import {
    type ModerationActionInput,
    moderationActionSchema,
} from "@/lib/moderation/schema";
import { clearExpiredSuspensions } from "@/lib/moderation/service";
import { writeAuditLog } from "@/lib/security/audit-log";
import {
    buildRateLimitHeaders,
    consumeRequestRateLimit,
    getRequestIp,
} from "@/lib/security/request-rate-limit";
import { z } from "zod";

export const dynamic = "force-dynamic";

const routeParamsSchema = z.object({
    id: z.coerce.number().int().min(1),
});

function toSuspensionState(input: ModerationActionInput) {
    if (input.actionType !== "suspend") {
        return {
            isSuspended: false,
            suspendedAt: null,
            suspendedUntil: null,
            suspensionReason: null,
        };
    }

    return {
        isSuspended: true,
        suspendedAt: new Date(),
        suspendedUntil: input.suspendedUntil ? new Date(input.suspendedUntil) : null,
        suspensionReason: input.reason,
    };
}

export async function POST(
    request: NextRequest,
    context: { params: Promise<{ id: string }> }
) {
    const adminSession = await requireAdminSession();
    if (adminSession instanceof NextResponse) {
        return adminSession;
    }

    const rateLimit = consumeRequestRateLimit({
        bucket: "admin-user-moderation-write",
        key: `admin:${adminSession.id}:${getRequestIp(request)}`,
        windowMs: 60_000,
        maxRequests: 30,
    });
    if (!rateLimit.allowed) {
        return NextResponse.json(
            { error: "Cok fazla moderasyon islemi denemesi. Lutfen biraz bekleyin." },
            { status: 429, headers: buildRateLimitHeaders(rateLimit) }
        );
    }

    const params = await context.params;
    const parsedParams = routeParamsSchema.safeParse(params);
    if (!parsedParams.success) {
        return NextResponse.json({ error: "Gecersiz kullanici." }, { status: 422 });
    }

    try {
        await clearExpiredSuspensions();

        const body = await request.json();
        const action = moderationActionSchema.parse(body);
        const targetUserId = parsedParams.data.id;

        if (targetUserId === adminSession.id) {
            return NextResponse.json(
                { error: "Kendi hesabiniza moderasyon islemi uygulayamazsiniz." },
                { status: 403 }
            );
        }

        const targetUser = await prisma.user.findUnique({
            where: { id: targetUserId },
            select: {
                id: true,
                username: true,
                role: true,
                isSuspended: true,
            },
        });

        if (!targetUser) {
            return NextResponse.json({ error: "Kullanici bulunamadi." }, { status: 404 });
        }

        if (targetUser.role === "admin") {
            return NextResponse.json(
                { error: "Admin hesaplari bu panelden moderasyona kapali." },
                { status: 403 }
            );
        }

        if (action.actionType === "reactivate" && !targetUser.isSuspended) {
            return NextResponse.json(
                { error: "Kullanici zaten aktif durumda." },
                { status: 409 }
            );
        }

        if (action.actionType === "suspend" && targetUser.isSuspended) {
            return NextResponse.json(
                { error: "Kullanici zaten askiya alinmis durumda." },
                { status: 409 }
            );
        }

        const result = await prisma.$transaction(async (transaction) => {
            if (action.actionType !== "note") {
                await transaction.user.update({
                    where: { id: targetUserId },
                    data: toSuspensionState(action),
                });
            }

            const event = await transaction.userModerationEvent.create({
                data: {
                    targetUserId,
                    actorUserId: adminSession.id,
                    actionType: action.actionType,
                    reason: action.reason,
                    suspendedUntil: action.suspendedUntil
                        ? new Date(action.suspendedUntil)
                        : null,
                },
                include: {
                    actorUser: {
                        select: {
                            id: true,
                            username: true,
                            role: true,
                        },
                    },
                },
            });

            return event;
        });

        await writeAuditLog({
            actor: adminSession,
            action: `admin.user.${action.actionType}`,
            resourceType: "user",
            resourceId: targetUserId,
            summary: `${action.actionType} applied to ${targetUser.username}`,
            metadata: {
                targetUserId,
                targetUsername: targetUser.username,
                actionType: action.actionType,
                suspendedUntil: action.suspendedUntil ?? null,
            },
            request,
        });

        return NextResponse.json(
            {
                ok: true,
                event: {
                    id: result.id,
                    actionType: result.actionType,
                    reason: result.reason,
                    suspendedUntil: result.suspendedUntil?.toISOString() ?? null,
                    createdAt: result.createdAt.toISOString(),
                    actor: result.actorUser
                        ? {
                              id: result.actorUser.id,
                              username: result.actorUser.username,
                              role: result.actorUser.role,
                          }
                        : null,
                },
            },
            { headers: buildRateLimitHeaders(rateLimit) }
        );
    } catch (error) {
        if (error instanceof z.ZodError) {
            return NextResponse.json(
                { error: "Gecersiz moderasyon verisi.", details: error.issues },
                { status: 400 }
            );
        }

        console.error("Failed to apply moderation action:", error);
        return NextResponse.json(
            { error: "Moderasyon islemi uygulanamadi." },
            { status: 500 }
        );
    }
}
