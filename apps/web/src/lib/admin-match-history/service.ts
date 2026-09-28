import type { Prisma } from "@hushle/platform-db";
import { prisma } from "@/lib/prisma";
import type { AdminMatchHistoryQuery } from "@/lib/admin-match-history/schema";
import type {
    AdminMatchHistoryItem,
    AdminMatchHistoryResponse,
    AdminMatchLineupIdentity,
} from "@/types/admin-match-history";

type AuditSource = "hot" | "archive";

interface AuditReviewRecord {
    resourceId: string | null;
    metadata: Prisma.JsonValue | null;
    source: AuditSource;
}

function asMetadataRecord(
    metadata: Prisma.JsonValue | null
): Record<string, Prisma.JsonValue> | null {
    return metadata &&
        typeof metadata === "object" &&
        !Array.isArray(metadata)
        ? (metadata as Record<string, Prisma.JsonValue>)
        : null;
}

function readString(
    record: Record<string, Prisma.JsonValue> | null,
    key: string
): string | null {
    const value = record?.[key];
    return typeof value === "string" && value.trim() ? value : null;
}

function readNumber(
    record: Record<string, Prisma.JsonValue> | null,
    key: string
): number | null {
    const value = record?.[key];
    return typeof value === "number" && Number.isFinite(value) ? value : null;
}

function readBoolean(
    record: Record<string, Prisma.JsonValue> | null,
    key: string
): boolean {
    return record?.[key] === true;
}

function readStringArray(
    record: Record<string, Prisma.JsonValue> | null,
    key: string
): string[] {
    const value = record?.[key];
    return Array.isArray(value)
        ? value.filter(
              (entry): entry is string =>
                  typeof entry === "string" && entry.trim().length > 0
          )
        : [];
}

export function readMatchLineupIdentities(
    metadata: Prisma.JsonValue | null
): AdminMatchLineupIdentity[] {
    const value = asMetadataRecord(metadata)?.lineupIdentities;
    if (!Array.isArray(value)) return [];

    return value.flatMap((entry) => {
        if (!entry || typeof entry !== "object" || Array.isArray(entry)) {
            return [];
        }
        const item = entry as Record<string, Prisma.JsonValue>;
        const playerId =
            typeof item.playerId === "string" ? item.playerId : null;
        const identityType =
            item.identityType === "registered" || item.identityType === "guest"
                ? item.identityType
                : null;
        const displayNameSnapshot =
            typeof item.displayNameSnapshot === "string"
                ? item.displayNameSnapshot
                : null;
        if (!playerId || !identityType || !displayNameSnapshot) return [];

        return [
            {
                playerId,
                userId:
                    typeof item.userId === "number" ? item.userId : null,
                identityType,
                usernameSnapshot:
                    typeof item.usernameSnapshot === "string"
                        ? item.usernameSnapshot
                        : null,
                displayNameSnapshot,
                team:
                    item.team === "A" || item.team === "B"
                        ? item.team
                        : null,
            },
        ];
    });
}

function mapReview(
    audit: AuditReviewRecord | undefined
): AdminMatchHistoryItem["review"] {
    if (!audit) return null;
    const metadata = asMetadataRecord(audit.metadata);
    return {
        auditSource: audit.source,
        eligibilityReasons: readStringArray(metadata, "eligibilityReasons"),
        reviewFlags: readStringArray(metadata, "reviewFlags"),
        requestedRewardCoin: readNumber(metadata, "requestedRewardCoin"),
        allowedRewardCoin: readNumber(metadata, "allowedRewardCoin"),
        blockedRewardCoin: readNumber(metadata, "blockedRewardCoin"),
        rewardGuardTriggered: readBoolean(
            metadata,
            "rewardGuardTriggered"
        ),
        rewardGuardBand: readString(metadata, "rewardGuardBand"),
        repeatedGroupTriggered: readBoolean(
            metadata,
            "repeatedGroupTriggered"
        ),
        lineupIdentities: readMatchLineupIdentities(audit.metadata),
    };
}

export async function getAdminUserMatchHistory(
    userId: number,
    query: AdminMatchHistoryQuery
): Promise<AdminMatchHistoryResponse | null> {
    const { page, limit } = query;
    const [user, matches, wins, aggregate] = await Promise.all([
        prisma.user.findUnique({
            where: { id: userId },
            select: {
                id: true,
                username: true,
                profile: { select: { displayName: true } },
            },
        }),
        prisma.matchResult.findMany({
            where: { userId },
            orderBy: [
                { matchStartedAt: "desc" },
                { id: "desc" },
            ],
            skip: (page - 1) * limit,
            take: limit,
        }),
        prisma.matchResult.count({ where: { userId, won: true } }),
        prisma.matchResult.aggregate({
            where: { userId },
            _sum: { coinEarned: true },
            _avg: { matchDurationSeconds: true },
            _count: { _all: true, matchDurationSeconds: true },
        }),
    ]);

    if (!user) return null;

    const resourceIds = matches.map((match) => String(match.id));
    const [hotAudits, archivedAudits] =
        resourceIds.length === 0
            ? [[], []]
            : await Promise.all([
                  prisma.auditLog.findMany({
                      where: {
                          action: "game.match.finalize",
                          resourceType: "match_result",
                          resourceId: { in: resourceIds },
                      },
                      select: { resourceId: true, metadata: true },
                  }),
                  prisma.auditLogArchive.findMany({
                      where: {
                          action: "game.match.finalize",
                          resourceType: "match_result",
                          resourceId: { in: resourceIds },
                      },
                      select: { resourceId: true, metadata: true },
                  }),
              ]);

    const auditByResourceId = new Map<string, AuditReviewRecord>();
    for (const audit of archivedAudits) {
        if (audit.resourceId) {
            auditByResourceId.set(audit.resourceId, {
                ...audit,
                source: "archive",
            });
        }
    }
    for (const audit of hotAudits) {
        if (audit.resourceId) {
            auditByResourceId.set(audit.resourceId, {
                ...audit,
                source: "hot",
            });
        }
    }

    return {
        user: {
            id: user.id,
            username: user.username,
            displayName: user.profile?.displayName ?? null,
        },
        matches: matches.map((match) => {
            const audit = auditByResourceId.get(String(match.id));
            const metadata = asMetadataRecord(audit?.metadata ?? null);
            const auditEndedAt = readString(metadata, "matchEndedAt");
            const auditDuration = readNumber(metadata, "sureSeconds");
            const auditFormat = readString(metadata, "matchFormat");
            const auditTarget = readNumber(metadata, "matchTarget");

            return {
                id: match.id,
                roomCode: match.roomCode,
                gameType: match.gameType,
                matchStartedAt: match.matchStartedAt.toISOString(),
                matchEndedAt:
                    match.matchEndedAt?.toISOString() ?? auditEndedAt,
                matchDurationSeconds:
                    match.matchDurationSeconds ?? auditDuration,
                matchFormat:
                    match.matchFormat === "tur" ||
                    match.matchFormat === "skor"
                        ? match.matchFormat
                        : auditFormat === "tur" || auditFormat === "skor"
                          ? auditFormat
                          : null,
                matchTarget: match.matchTarget ?? auditTarget,
                playerId: match.playerId,
                team:
                    match.team === "A" || match.team === "B"
                        ? match.team
                        : null,
                won: match.won,
                scoreA: match.scoreA,
                scoreB: match.scoreB,
                coinEarned: match.coinEarned,
                lineupPlayerCount: match.lineupPlayerCount,
                lineupAuthenticatedCount:
                    match.lineupAuthenticatedCount,
                lineupGuestCount: match.lineupGuestCount,
                createdAt: match.createdAt.toISOString(),
                review: mapReview(audit),
            };
        }),
        total: aggregate._count._all,
        page,
        pages: Math.max(
            1,
            Math.ceil(aggregate._count._all / limit)
        ),
        summary: {
            wins,
            totalCoinEarned: aggregate._sum.coinEarned ?? 0,
            averageDurationSeconds:
                aggregate._avg.matchDurationSeconds === null
                    ? null
                    : Math.round(aggregate._avg.matchDurationSeconds),
            durationSampleCount: aggregate._count.matchDurationSeconds,
        },
    };
}
