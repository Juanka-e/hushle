import { prisma } from "@/lib/prisma";
import type {
    SupportAdminListResponse,
    SupportDeskResponse,
    SupportTicketActorView,
    SupportTicketMessageView,
    SupportTicketPriority,
    SupportTicketStatus,
    SupportTicketView,
} from "@/types/support";
import type {
    SupportAdminListQuery,
    SupportTicketAdminMessageInput,
    SupportTicketAdminUpdateInput,
    SupportTicketCreateInput,
    SupportTicketReplyInput,
} from "@/lib/support/schema";
import {
    createUserNotificationWithClient,
    shouldCreateSupportStatusNotification,
} from "@/lib/notifications/service";
import { invalidateNotificationUnreadCountCache } from "@/lib/cache/application-cache";

type SupportTicketRecord = {
    id: number;
    subject: string;
    category: string;
    priority: SupportTicketPriority;
    status: SupportTicketStatus;
    createdAt: Date;
    updatedAt: Date;
    lastMessageAt: Date;
    lastPublicReplyAt: Date | null;
    closedAt: Date | null;
    user: {
        id: number;
        username: string;
        role: string;
    };
    assignedAdmin: {
        id: number;
        username: string;
        role: string;
    } | null;
    messages: Array<{
        id: number;
        body: string;
        isInternal: boolean;
        createdAt: Date;
        author: {
            id: number;
            username: string;
            role: string;
        } | null;
    }>;
};

export class SupportDeskWorkflowError extends Error {
    public readonly retryAfterSeconds?: number;

    constructor(
        public readonly code:
            | "ticket_not_found"
            | "forbidden"
            | "ticket_closed"
            | "invalid_assignee"
            | "reply_cooldown",
        options?: { retryAfterSeconds?: number }
    ) {
        super(code);
        this.retryAfterSeconds = options?.retryAfterSeconds;
    }
}

export const SUPPORT_TICKET_REPLY_COOLDOWN_SECONDS = 30;

function mapActor(actor: { id: number; username: string; role: string } | null): SupportTicketActorView | null {
    if (!actor) {
        return null;
    }

    return {
        id: actor.id,
        username: actor.username,
        role: actor.role,
    };
}

function mapMessage(message: SupportTicketRecord["messages"][number]): SupportTicketMessageView {
    return {
        id: message.id,
        body: message.body,
        isInternal: message.isInternal,
        createdAt: message.createdAt.toISOString(),
        author: mapActor(message.author),
    };
}

function mapTicket(ticket: SupportTicketRecord): SupportTicketView {
    return {
        id: ticket.id,
        subject: ticket.subject,
        category: ticket.category as SupportTicketView["category"],
        priority: ticket.priority,
        status: ticket.status,
        createdAt: ticket.createdAt.toISOString(),
        updatedAt: ticket.updatedAt.toISOString(),
        lastMessageAt: ticket.lastMessageAt.toISOString(),
        lastPublicReplyAt: ticket.lastPublicReplyAt?.toISOString() ?? null,
        closedAt: ticket.closedAt?.toISOString() ?? null,
        user: mapActor(ticket.user)!,
        assignedAdmin: mapActor(ticket.assignedAdmin),
        messages: ticket.messages.map(mapMessage),
    };
}

function buildUserReplyNextStatus(status: SupportTicketStatus): SupportTicketStatus | null {
    if (status === "closed" || status === "resolved") {
        return null;
    }

    return status;
}

function buildAdminMessageNextStatus(
    status: SupportTicketStatus,
    isInternal: boolean
): SupportTicketStatus | null {
    if (isInternal) {
        return status;
    }

    if (status === "closed") {
        return null;
    }

    if (status === "open" || status === "resolved") {
        return "in_progress";
    }

    return status;
}

export function getSupportStatusAfterUserReply(status: SupportTicketStatus): SupportTicketStatus | null {
    return buildUserReplyNextStatus(status);
}

export function getSupportStatusAfterAdminMessage(
    status: SupportTicketStatus,
    isInternal: boolean
): SupportTicketStatus | null {
    return buildAdminMessageNextStatus(status, isInternal);
}

async function getTicketOrThrow(ticketId: number) {
    const ticket = await prisma.supportTicket.findUnique({
        where: { id: ticketId },
        select: {
            id: true,
            userId: true,
            status: true,
        },
    });

    if (!ticket) {
        throw new SupportDeskWorkflowError("ticket_not_found");
    }

    return ticket;
}

export async function listSupportTicketsForUser(userId: number): Promise<SupportDeskResponse> {
    const tickets = await prisma.supportTicket.findMany({
        where: { userId },
        orderBy: [{ lastMessageAt: "desc" }, { id: "desc" }],
        take: 24,
        include: {
            user: {
                select: {
                    id: true,
                    username: true,
                    role: true,
                },
            },
            assignedAdmin: {
                select: {
                    id: true,
                    username: true,
                    role: true,
                },
            },
            messages: {
                where: { isInternal: false },
                orderBy: [{ createdAt: "asc" }, { id: "asc" }],
                include: {
                    author: {
                        select: {
                            id: true,
                            username: true,
                            role: true,
                        },
                    },
                },
            },
        },
    });

    return {
        tickets: tickets.map((ticket) => mapTicket(ticket as SupportTicketRecord)),
    };
}

export async function createSupportTicketForUser(
    userId: number,
    input: SupportTicketCreateInput
): Promise<SupportTicketView> {
    const createdAt = new Date();

    const ticket = await prisma.$transaction(async (tx) => {
        const createdTicket = await tx.supportTicket.create({
            data: {
                userId,
                category: input.category,
                subject: input.subject,
                status: "open",
                priority: "normal",
                lastMessageAt: createdAt,
            },
        });

        await tx.supportTicketMessage.create({
            data: {
                ticketId: createdTicket.id,
                authorUserId: userId,
                isInternal: false,
                body: input.message,
            },
        });

        return tx.supportTicket.findUniqueOrThrow({
            where: { id: createdTicket.id },
            include: {
                user: {
                    select: {
                        id: true,
                        username: true,
                        role: true,
                    },
                },
                assignedAdmin: {
                    select: {
                        id: true,
                        username: true,
                        role: true,
                    },
                },
                messages: {
                    where: { isInternal: false },
                    orderBy: [{ createdAt: "asc" }, { id: "asc" }],
                    include: {
                        author: {
                            select: {
                                id: true,
                                username: true,
                                role: true,
                            },
                        },
                    },
                },
            },
        });
    });

    return mapTicket(ticket as SupportTicketRecord);
}

export async function addSupportReplyForUser(
    ticketId: number,
    userId: number,
    input: SupportTicketReplyInput
): Promise<SupportTicketView> {
    const ticket = await getTicketOrThrow(ticketId);
    if (ticket.userId !== userId) {
        throw new SupportDeskWorkflowError("forbidden");
    }

    const nextStatus = buildUserReplyNextStatus(ticket.status as SupportTicketStatus);
    if (!nextStatus) {
        throw new SupportDeskWorkflowError("ticket_closed");
    }

    const lastUserMessage = await prisma.supportTicketMessage.findFirst({
        where: {
            ticketId,
            authorUserId: userId,
            isInternal: false,
        },
        orderBy: [{ createdAt: "desc" }, { id: "desc" }],
        select: {
            createdAt: true,
        },
    });

    if (lastUserMessage) {
        const elapsedMs = Date.now() - lastUserMessage.createdAt.getTime();
        const cooldownMs = SUPPORT_TICKET_REPLY_COOLDOWN_SECONDS * 1000;

        if (elapsedMs < cooldownMs) {
            throw new SupportDeskWorkflowError("reply_cooldown", {
                retryAfterSeconds: Math.max(
                    1,
                    Math.ceil((cooldownMs - elapsedMs) / 1000)
                ),
            });
        }
    }

    const now = new Date();
    const updated = await prisma.$transaction(async (tx) => {
        await tx.supportTicketMessage.create({
            data: {
                ticketId,
                authorUserId: userId,
                isInternal: false,
                body: input.body,
            },
        });

        await tx.supportTicket.update({
            where: { id: ticketId },
            data: {
                status: nextStatus,
                lastMessageAt: now,
                closedAt: nextStatus === "closed" ? now : null,
            },
        });

        return tx.supportTicket.findUniqueOrThrow({
            where: { id: ticketId },
            include: {
                user: {
                    select: {
                        id: true,
                        username: true,
                        role: true,
                    },
                },
                assignedAdmin: {
                    select: {
                        id: true,
                        username: true,
                        role: true,
                    },
                },
                messages: {
                    where: { isInternal: false },
                    orderBy: [{ createdAt: "asc" }, { id: "asc" }],
                    include: {
                        author: {
                            select: {
                                id: true,
                                username: true,
                                role: true,
                            },
                        },
                    },
                },
            },
        });
    });

    return mapTicket(updated as SupportTicketRecord);
}

export async function listSupportTicketsForAdmin(
    input: SupportAdminListQuery
): Promise<SupportAdminListResponse> {
    const { page, limit, search, status } = input;

    const where = {
        ...(search
            ? {
                  OR: [
                      { subject: { contains: search } },
                      { user: { username: { contains: search } } },
                  ],
              }
            : {}),
        ...(status !== "all" ? { status } : {}),
    };

    const [tickets, total, assignableAdmins] = await Promise.all([
        prisma.supportTicket.findMany({
            where,
            orderBy: [{ lastMessageAt: "desc" }, { id: "desc" }],
            skip: (page - 1) * limit,
            take: limit,
            include: {
                user: {
                    select: {
                        id: true,
                        username: true,
                        role: true,
                    },
                },
                assignedAdmin: {
                    select: {
                        id: true,
                        username: true,
                        role: true,
                    },
                },
                messages: {
                    orderBy: [{ createdAt: "asc" }, { id: "asc" }],
                    include: {
                        author: {
                            select: {
                                id: true,
                                username: true,
                                role: true,
                            },
                        },
                    },
                },
            },
        }),
        prisma.supportTicket.count({ where }),
        prisma.user.findMany({
            where: { role: "admin", isSuspended: false },
            orderBy: [{ username: "asc" }],
            select: {
                id: true,
                username: true,
            },
        }),
    ]);

    return {
        tickets: tickets.map((ticket) => mapTicket(ticket as SupportTicketRecord)),
        total,
        page,
        pages: Math.max(1, Math.ceil(total / limit)),
        assignableAdmins,
    };
}

export async function updateSupportTicketByAdmin(
    ticketId: number,
    input: SupportTicketAdminUpdateInput
): Promise<SupportTicketView> {
    const existingTicket = await getTicketOrThrow(ticketId);

    if (input.assignedAdminUserId !== undefined && input.assignedAdminUserId !== null) {
        const assignee = await prisma.user.findUnique({
            where: { id: input.assignedAdminUserId },
            select: {
                id: true,
                role: true,
                isSuspended: true,
            },
        });

        if (!assignee || assignee.role !== "admin" || assignee.isSuspended) {
            throw new SupportDeskWorkflowError("invalid_assignee");
        }
    }

    const ticket = await prisma.supportTicket.update({
        where: { id: ticketId },
        data: {
            ...(input.status !== undefined
                ? {
                      status: input.status,
                      closedAt: input.status === "closed" ? new Date() : null,
                  }
                : {}),
            ...(input.priority !== undefined ? { priority: input.priority } : {}),
            ...(input.assignedAdminUserId !== undefined
                ? { assignedAdminUserId: input.assignedAdminUserId }
                : {}),
        },
        include: {
            user: {
                select: {
                    id: true,
                    username: true,
                    role: true,
                },
            },
            assignedAdmin: {
                select: {
                    id: true,
                    username: true,
                    role: true,
                },
            },
            messages: {
                orderBy: [{ createdAt: "asc" }, { id: "asc" }],
                include: {
                    author: {
                        select: {
                            id: true,
                            username: true,
                            role: true,
                        },
                    },
                },
            },
        },
    });

    if (
        input.status &&
        shouldCreateSupportStatusNotification(existingTicket.status, input.status)
    ) {
        await createUserNotificationWithClient(prisma, {
            userId: existingTicket.userId,
            type: "support_status",
            title: input.status === "resolved" ? "Destek talebin cozuldu" : "Destek talebin kapatildi",
            body:
                input.status === "resolved"
                    ? `#${ticket.id} numarali destek talebin cozuldu olarak isaretlendi. Gerekirse yardim merkezinden yeni bir talep acabilirsin.`
                    : `#${ticket.id} numarali destek talebin kapatildi. Yeni bir konu varsa yardim merkezinden yeni talep acabilirsin.`,
            resourceType: "support_ticket",
            resourceId: ticket.id,
            actionLabel: "Yardim merkezinde ac",
        });
    }

    return mapTicket(ticket as SupportTicketRecord);
}

export async function addSupportMessageByAdmin(
    ticketId: number,
    adminUserId: number,
    input: SupportTicketAdminMessageInput
): Promise<SupportTicketView> {
    const ticket = await getTicketOrThrow(ticketId);
    const nextStatus = buildAdminMessageNextStatus(
        ticket.status as SupportTicketStatus,
        input.isInternal
    );

    if (!nextStatus) {
        throw new SupportDeskWorkflowError("ticket_closed");
    }

    const now = new Date();
    const updated = await prisma.$transaction(async (tx) => {
        await tx.supportTicketMessage.create({
            data: {
                ticketId,
                authorUserId: adminUserId,
                isInternal: input.isInternal,
                body: input.body,
            },
        });

        await tx.supportTicket.update({
            where: { id: ticketId },
            data: {
                status: nextStatus,
                lastMessageAt: now,
                ...(input.isInternal ? {} : { lastPublicReplyAt: now }),
                closedAt: nextStatus === "closed" ? now : null,
            },
        });

        if (!input.isInternal) {
            await createUserNotificationWithClient(tx, {
                userId: ticket.userId,
                type: "support_reply",
                title: "Destek ekibinden yeni cevap var",
                body: input.body,
                resourceType: "support_ticket",
                resourceId: ticketId,
                actionLabel: "Yardim merkezinde ac",
            }, { deferCacheInvalidation: true });
        }

        return tx.supportTicket.findUniqueOrThrow({
            where: { id: ticketId },
            include: {
                user: {
                    select: {
                        id: true,
                        username: true,
                        role: true,
                    },
                },
                assignedAdmin: {
                    select: {
                        id: true,
                        username: true,
                        role: true,
                    },
                },
                messages: {
                    orderBy: [{ createdAt: "asc" }, { id: "asc" }],
                    include: {
                        author: {
                            select: {
                                id: true,
                                username: true,
                                role: true,
                            },
                        },
                    },
                },
            },
        });
    });

    if (!input.isInternal) {
        await invalidateNotificationUnreadCountCache(ticket.userId);
    }
    return mapTicket(updated as SupportTicketRecord);
}
