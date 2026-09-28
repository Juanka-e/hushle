import { EmailOutboxStatus, prisma } from "@hushle/platform-db";
import type {
    AdminEmailDeliveryResponse,
    AdminEmailDeliveryStatus,
} from "@/types/admin-email-delivery";

const STATUSES: AdminEmailDeliveryStatus[] = [
    "pending",
    "processing",
    "sent",
    "dead_letter",
];

export async function listEmailDeliveryForAdmin(input: {
    page: number;
    limit: number;
    status: "all" | AdminEmailDeliveryStatus;
    search?: string;
}): Promise<AdminEmailDeliveryResponse> {
    const where = {
        ...(input.status === "all" ? {} : { status: input.status }),
        ...(input.search
            ? {
                  OR: [
                      { recipient: { contains: input.search } },
                      { template: { contains: input.search } },
                      { id: { contains: input.search } },
                  ],
              }
            : {}),
    };
    const [rows, total, grouped] = await prisma.$transaction([
        prisma.emailOutboxMessage.findMany({
            where,
            orderBy: { createdAt: "desc" },
            skip: (input.page - 1) * input.limit,
            take: input.limit,
            include: { user: { select: { username: true } } },
        }),
        prisma.emailOutboxMessage.count({ where }),
        prisma.emailOutboxMessage.groupBy({
            by: ["status"],
            orderBy: { status: "asc" },
            _count: { id: true },
        }),
    ]);
    const normalizedRecipients = [...new Set(rows.map((row) => row.recipient.trim().toLowerCase()))];
    const suppressions = normalizedRecipients.length
        ? await prisma.emailSuppression.findMany({
              where: { normalizedEmail: { in: normalizedRecipients } },
              select: { normalizedEmail: true, reason: true, scope: true },
          })
        : [];
    const suppressionByEmail = new Map(
        suppressions.map((entry) => [entry.normalizedEmail, entry] as const)
    );
    const counts = Object.fromEntries(STATUSES.map((status) => [status, 0])) as Record<
        AdminEmailDeliveryStatus,
        number
    >;
    for (const entry of grouped) {
        counts[entry.status] =
            typeof entry._count === "object" && entry._count
                ? entry._count.id ?? 0
                : 0;
    }

    return {
        items: rows.map((row) => {
            const suppression = suppressionByEmail.get(row.recipient.trim().toLowerCase());
            return {
                id: row.id,
                userId: row.userId,
                username: row.user?.username ?? null,
                recipient: row.recipient,
                messageClass: row.messageClass,
                template: row.template,
                subject: row.subject,
                status: row.status,
                attemptCount: row.attemptCount,
                manualRetryCount: row.manualRetryCount,
                availableAt: row.availableAt.toISOString(),
                lastAttemptAt: row.lastAttemptAt?.toISOString() ?? null,
                sentAt: row.sentAt?.toISOString() ?? null,
                lastError: row.lastError,
                createdAt: row.createdAt.toISOString(),
                suppression: suppression
                    ? { reason: suppression.reason, scope: suppression.scope }
                    : null,
            };
        }),
        page: input.page,
        pages: Math.max(1, Math.ceil(total / input.limit)),
        total,
        counts,
    };
}

export async function retryDeadLetterEmail(id: string, now = new Date()) {
    const message = await prisma.emailOutboxMessage.findUnique({ where: { id } });
    if (!message) return { ok: false as const, reason: "not_found" as const };
    if (message.status !== EmailOutboxStatus.dead_letter) {
        return { ok: false as const, reason: "not_dead_letter" as const };
    }
    const suppression = await prisma.emailSuppression.findUnique({
        where: { normalizedEmail: message.recipient.trim().toLowerCase() },
    });
    if (suppression) return { ok: false as const, reason: "suppressed" as const };

    const updated = await prisma.emailOutboxMessage.updateMany({
        where: { id, status: EmailOutboxStatus.dead_letter },
        data: {
            status: EmailOutboxStatus.pending,
            attemptCount: 0,
            manualRetryCount: { increment: 1 },
            availableAt: now,
            lastError: null,
            claimToken: null,
            claimedAt: null,
            claimExpiresAt: null,
            lastManualRetryAt: now,
        },
    });
    return updated.count === 1
        ? { ok: true as const, message }
        : { ok: false as const, reason: "conflict" as const };
}
