import { prisma } from "@/lib/prisma";
import type {
    AdminUserListResponse,
    AdminUserModerationView,
    ModerationActionType,
    ModerationEventView,
} from "@/types/moderation";

interface SuspendedRecord {
    isSuspended: boolean;
    suspendedUntil: Date | null;
}

export function isSuspensionActive(record: SuspendedRecord): boolean {
    if (!record.isSuspended) {
        return false;
    }

    if (!record.suspendedUntil) {
        return true;
    }

    return record.suspendedUntil.getTime() > Date.now();
}

export async function clearExpiredSuspensions(): Promise<void> {
    await prisma.user.updateMany({
        where: {
            isSuspended: true,
            suspendedUntil: {
                not: null,
                lte: new Date(),
            },
        },
        data: {
            isSuspended: false,
            suspendedAt: null,
            suspendedUntil: null,
            suspensionReason: null,
        },
    });
}

function mapModerationEvent(event: {
    id: number;
    actionType: ModerationActionType;
    reason: string;
    suspendedUntil: Date | null;
    createdAt: Date;
    actorUser: { id: number; username: string; role: string } | null;
}): ModerationEventView {
    return {
        id: event.id,
        actionType: event.actionType,
        reason: event.reason,
        suspendedUntil: event.suspendedUntil?.toISOString() ?? null,
        createdAt: event.createdAt.toISOString(),
        actor: event.actorUser
            ? {
                  id: event.actorUser.id,
                  username: event.actorUser.username,
                  role: event.actorUser.role,
              }
            : null,
    };
}

function mapAdminUser(user: {
    id: number;
    username: string;
    email: string | null;
    emailVerifiedAt: Date | null;
    role: string;
    createdAt: Date;
    isSuspended: boolean;
    suspendedAt: Date | null;
    suspendedUntil: Date | null;
    suspensionReason: string | null;
    lastSeenAt: Date | null;
    lastTrustedIp: string | null;
    registeredTrustedIp: string | null;
    lastUserAgent: string | null;
    _count: {
        supportTicketsOwned: number;
    };
    wallet: { coinBalance: number } | null;
    supportTicketsOwned: Array<{
        id: number;
        subject: string;
        status: string;
        updatedAt: Date;
    }>;
    walletAdjustmentsReceived: Array<{
        id: number;
        adjustmentType: "credit" | "debit";
        amount: number;
        reason: string;
        createdAt: Date;
    }>;
    profile: { displayName: string | null } | null;
    moderationActionsReceived: Array<{
        id: number;
        actionType: ModerationActionType;
        reason: string;
        suspendedUntil: Date | null;
        createdAt: Date;
        actorUser: { id: number; username: string; role: string } | null;
    }>;
}): AdminUserModerationView {
    return {
        id: user.id,
        username: user.username,
        email: user.email,
        emailVerifiedAt: user.emailVerifiedAt?.toISOString() ?? null,
        role: user.role,
        createdAt: user.createdAt.toISOString(),
        displayName: user.profile?.displayName ?? null,
        coinBalance: user.wallet?.coinBalance ?? 0,
        isSuspended: isSuspensionActive(user),
        suspendedAt: user.suspendedAt?.toISOString() ?? null,
        suspendedUntil: user.suspendedUntil?.toISOString() ?? null,
        suspensionReason: user.suspensionReason,
        lastSeenAt: user.lastSeenAt?.toISOString() ?? null,
        lastTrustedIp: user.lastTrustedIp,
        registeredTrustedIp: user.registeredTrustedIp,
        lastUserAgent: user.lastUserAgent,
        supportTicketSummary: {
            total: user._count.supportTicketsOwned,
            openCount: user.supportTicketsOwned.filter((ticket) => ticket.status === "open" || ticket.status === "in_progress").length,
            latestTicketId: user.supportTicketsOwned[0]?.id ?? null,
            latestStatus: user.supportTicketsOwned[0]?.status ?? null,
            latestSubject: user.supportTicketsOwned[0]?.subject ?? null,
            latestUpdatedAt: user.supportTicketsOwned[0]?.updatedAt.toISOString() ?? null,
        },
        walletAdjustmentSummary: {
            latestAdjustmentId: user.walletAdjustmentsReceived[0]?.id ?? null,
            latestType: user.walletAdjustmentsReceived[0]?.adjustmentType ?? null,
            latestAmount: user.walletAdjustmentsReceived[0]?.amount ?? null,
            latestReason: user.walletAdjustmentsReceived[0]?.reason ?? null,
            latestCreatedAt: user.walletAdjustmentsReceived[0]?.createdAt.toISOString() ?? null,
        },
        recentModerationEvents: user.moderationActionsReceived.map(mapModerationEvent),
    };
}

export async function getAdminUsers(input: {
    page: number;
    limit: number;
    search: string;
    status: "all" | "active" | "suspended";
}): Promise<AdminUserListResponse> {
    await clearExpiredSuspensions();

    const { page, limit, search, status } = input;
    const where = {
        ...(search
            ? {
                  OR: [
                      {
                          username: {
                              contains: search,
                          },
                      },
                      {
                          email: {
                              contains: search,
                          },
                      },
                      {
                          profile: {
                              is: {
                                  displayName: {
                                      contains: search,
                                  },
                              },
                          },
                      },
                  ],
              }
            : {}),
        ...(status === "suspended" ? { isSuspended: true } : {}),
        ...(status === "active" ? { isSuspended: false } : {}),
    };

    const [users, total] = await Promise.all([
        prisma.user.findMany({
            where,
            orderBy: [{ createdAt: "desc" }, { id: "desc" }],
            skip: (page - 1) * limit,
            take: limit,
            select: {
                id: true,
                username: true,
                email: true,
                emailVerifiedAt: true,
                role: true,
                createdAt: true,
                isSuspended: true,
                suspendedAt: true,
                suspendedUntil: true,
                suspensionReason: true,
                lastSeenAt: true,
                lastTrustedIp: true,
                registeredTrustedIp: true,
                lastUserAgent: true,
                _count: {
                    select: {
                        supportTicketsOwned: true,
                    },
                },
                wallet: {
                    select: {
                        coinBalance: true,
                    },
                },
                supportTicketsOwned: {
                    orderBy: [{ updatedAt: "desc" }, { id: "desc" }],
                    take: 3,
                    select: {
                        id: true,
                        subject: true,
                        status: true,
                        updatedAt: true,
                    },
                },
                walletAdjustmentsReceived: {
                    orderBy: [{ createdAt: "desc" }, { id: "desc" }],
                    take: 1,
                    select: {
                        id: true,
                        adjustmentType: true,
                        amount: true,
                        reason: true,
                        createdAt: true,
                    },
                },
                profile: {
                    select: {
                        displayName: true,
                    },
                },
                moderationActionsReceived: {
                    orderBy: {
                        createdAt: "desc",
                    },
                    take: 5,
                    select: {
                        id: true,
                        actionType: true,
                        reason: true,
                        suspendedUntil: true,
                        createdAt: true,
                        actorUser: {
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
        prisma.user.count({ where }),
    ]);

    return {
        users: users.map(mapAdminUser),
        total,
        page,
        pages: Math.max(1, Math.ceil(total / limit)),
        trustProxyEnabled: false,
    };
}
