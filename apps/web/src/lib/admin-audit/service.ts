import { prisma } from "@/lib/prisma";
import type { Prisma } from "@hushle/platform-db";
import type { AdminAuditListQuery } from "@/lib/admin-audit/schema";
import type { AdminAuditListResponse, AdminAuditLogView } from "@/types/admin-audit";

function stringifyMetadataValue(value: Prisma.JsonValue): string {
    if (value === null) {
        return "null";
    }

    if (typeof value === "string" || typeof value === "number" || typeof value === "boolean") {
        return String(value);
    }

    if (Array.isArray(value)) {
        return value.map(stringifyMetadataValue).join(", ");
    }

    return "[complex]";
}

export function summarizeAuditMetadata(
    metadata: Prisma.JsonValue | null,
    excludedKeys: string[] = []
): Record<string, string> {
    if (!metadata || typeof metadata !== "object" || Array.isArray(metadata)) {
        return {};
    }

    const entries = Object.entries(metadata)
        .filter(
            ([key]) =>
                key !== "reason" &&
                key !== "note" &&
                !excludedKeys.includes(key)
        )
        .slice(0, 8);
    return Object.fromEntries(
        entries.map(([key, value]) => [key, stringifyMetadataValue(value as Prisma.JsonValue)])
    );
}

function extractAuditNote(metadata: Prisma.JsonValue | null): string | null {
    if (!metadata || typeof metadata !== "object" || Array.isArray(metadata)) {
        return null;
    }

    const record = metadata as Record<string, Prisma.JsonValue>;
    const candidate = record.reason ?? record.note;
    return typeof candidate === "string" && candidate.trim().length > 0 ? candidate : null;
}

function readMetadataNumber(
    record: Record<string, Prisma.JsonValue>,
    key: string
): number | null {
    const value = record[key];
    return typeof value === "number" && Number.isFinite(value) ? value : null;
}

function readMetadataBoolean(
    record: Record<string, Prisma.JsonValue>,
    key: string
): boolean {
    return record[key] === true;
}

function readMetadataString(
    record: Record<string, Prisma.JsonValue>,
    key: string
): string | null {
    const value = record[key];
    return typeof value === "string" && value.trim().length > 0 ? value : null;
}

function readMetadataStringArray(
    record: Record<string, Prisma.JsonValue>,
    key: string
): string[] {
    const value = record[key];
    if (!Array.isArray(value)) {
        return [];
    }

    return value.filter(
        (entry): entry is string => typeof entry === "string" && entry.trim().length > 0
    );
}

function readMetadataLineupIdentities(
    record: Record<string, Prisma.JsonValue>,
    key: string
): NonNullable<NonNullable<AdminAuditLogView["economyGuard"]>["lineupIdentities"]> {
    const value = record[key];
    if (!Array.isArray(value)) {
        return [];
    }

    return value
        .map((entry) => {
            if (!entry || typeof entry !== "object" || Array.isArray(entry)) {
                return null;
            }

            const item = entry as Record<string, Prisma.JsonValue>;
            const playerId = typeof item.playerId === "string" ? item.playerId : null;
            const userId = typeof item.userId === "number" ? item.userId : null;
            const identityType =
                item.identityType === "registered" || item.identityType === "guest"
                    ? item.identityType
                    : null;
            const usernameSnapshot =
                typeof item.usernameSnapshot === "string" && item.usernameSnapshot.trim().length > 0
                    ? item.usernameSnapshot
                    : null;
            const displayNameSnapshot =
                typeof item.displayNameSnapshot === "string" && item.displayNameSnapshot.trim().length > 0
                    ? item.displayNameSnapshot
                    : null;
            const team =
                item.team === "A" || item.team === "B"
                    ? item.team
                    : null;

            if (!playerId || !identityType || !displayNameSnapshot) {
                return null;
            }

            return {
                playerId,
                userId,
                identityType,
                usernameSnapshot,
                displayNameSnapshot,
                team,
            };
        })
        .filter(
            (
                entry
            ): entry is NonNullable<
                AdminAuditLogView["economyGuard"]
            >["lineupIdentities"][number] => entry !== null
        );
}

function extractEconomyGuardSummary(
    action: string,
    metadata: Prisma.JsonValue | null
): AdminAuditLogView["economyGuard"] {
    if (
        action !== "game.match.finalize" ||
        !metadata ||
        typeof metadata !== "object" ||
        Array.isArray(metadata)
    ) {
        return null;
    }

    const record = metadata as Record<string, Prisma.JsonValue>;
    return {
        rewardSource: readMetadataString(record, "rewardSource"),
        requestedRewardCoin: readMetadataNumber(record, "requestedRewardCoin"),
        allowedRewardCoin: readMetadataNumber(record, "allowedRewardCoin"),
        blockedRewardCoin: readMetadataNumber(record, "blockedRewardCoin"),
        rewardGuardTriggered: readMetadataBoolean(record, "rewardGuardTriggered"),
        rewardGuardBand: readMetadataString(record, "rewardGuardBand"),
        repeatedGroupTriggered: readMetadataBoolean(record, "repeatedGroupTriggered"),
        repeatedGroupOrdinal: readMetadataNumber(record, "repeatedGroupCurrentOrdinal"),
        repeatedGroupThreshold: readMetadataNumber(record, "repeatedGroupThreshold"),
        roomCode: readMetadataString(record, "roomCode"),
        sureSeconds: readMetadataNumber(record, "sureSeconds"),
        lineupPlayers: readMetadataStringArray(record, "lineupPlayers"),
        lineupIdentities: readMetadataLineupIdentities(record, "lineupIdentities"),
    };
}

function mapAuditLog(log: {
    id: number;
    action: string;
    resourceType: string;
    resourceId: string | null;
    summary: string | null;
    ipAddress: string | null;
    userAgent: string | null;
    createdAt: Date;
    actorRole: string;
    metadata: Prisma.JsonValue | null;
    actor: { id: number; username: string | null; role: string } | null;
}, source: "hot" | "archive", archivedAt: Date | null = null): AdminAuditLogView {
    const metadataExcludedKeys =
        log.action === "game.match.finalize"
            ? [
                  "rewardSource",
                  "requestedRewardCoin",
                  "allowedRewardCoin",
                  "blockedRewardCoin",
                  "rewardGuardTriggered",
                  "rewardGuardBand",
                  "repeatedGroupTriggered",
                  "repeatedGroupCurrentOrdinal",
                  "repeatedGroupThreshold",
                  "roomCode",
                  "sureSeconds",
                  "lineupPlayers",
                  "lineupIdentities",
              ]
            : [];

    return {
        id: log.id,
        source,
        archivedAt: archivedAt?.toISOString() ?? null,
        action: log.action,
        resourceType: log.resourceType,
        resourceId: log.resourceId,
        summary: log.summary,
        note: extractAuditNote(log.metadata),
        ipAddress: log.ipAddress,
        userAgent: log.userAgent,
        createdAt: log.createdAt.toISOString(),
        actor: log.actor
            ? {
                  id: log.actor.id,
                  username: log.actor.username,
                  role: log.actor.role,
              }
            : {
                  id: null,
                  username: null,
                  role: log.actorRole,
              },
        metadata: summarizeAuditMetadata(log.metadata, metadataExcludedKeys),
        economyGuard: extractEconomyGuardSummary(log.action, log.metadata),
    };
}

export async function getAdminAuditLogs(
    input: AdminAuditListQuery
): Promise<AdminAuditListResponse> {
    const {
        page,
        limit,
        search,
        action,
        resourceType,
        actorRole,
        economyGuard,
        source,
    } = input;

    const economyGuardWhere =
        economyGuard === "match_reward"
            ? {
                  action: "game.match.finalize",
              }
            : economyGuard === "triggered"
              ? {
                    action: "game.match.finalize",
                    OR: [
                        {
                            metadata: {
                                path: "$.rewardGuardTriggered",
                                equals: true,
                            },
                        },
                        {
                            metadata: {
                                path: "$.repeatedGroupTriggered",
                                equals: true,
                            },
                        },
                    ],
                }
              : economyGuard === "ceiling"
                ? {
                      action: "game.match.finalize",
                      metadata: {
                          path: "$.rewardGuardTriggered",
                          equals: true,
                      },
                  }
                : economyGuard === "repeated_group"
                  ? {
                        action: "game.match.finalize",
                        metadata: {
                            path: "$.repeatedGroupTriggered",
                            equals: true,
                        },
                    }
                  : {};

    const commonWhere = {
        ...economyGuardWhere,
        ...(action ? { action } : {}),
        ...(resourceType ? { resourceType } : {}),
        ...(actorRole ? { actorRole } : {}),
    };

    if (source === "archive") {
        const where: Prisma.AuditLogArchiveWhereInput = {
            ...commonWhere,
            ...(search
                ? {
                      OR: [
                          { action: { contains: search } },
                          { resourceType: { contains: search } },
                          { resourceId: { contains: search } },
                          { summary: { contains: search } },
                          { actorUsername: { contains: search } },
                      ],
                  }
                : {}),
        };
        const [logs, total, actionGroups, resourceGroups, roleGroups] =
            await Promise.all([
                prisma.auditLogArchive.findMany({
                    where,
                    orderBy: [
                        { originalCreatedAt: "desc" },
                        { originalAuditLogId: "desc" },
                    ],
                    skip: (page - 1) * limit,
                    take: limit,
                }),
                prisma.auditLogArchive.count({ where }),
                prisma.auditLogArchive.groupBy({
                    by: ["action"],
                    orderBy: { action: "asc" },
                }),
                prisma.auditLogArchive.groupBy({
                    by: ["resourceType"],
                    orderBy: { resourceType: "asc" },
                }),
                prisma.auditLogArchive.groupBy({
                    by: ["actorRole"],
                    orderBy: { actorRole: "asc" },
                }),
            ]);

        return {
            logs: logs.map((log) =>
                mapAuditLog(
                    {
                        id: log.originalAuditLogId,
                        action: log.action,
                        resourceType: log.resourceType,
                        resourceId: log.resourceId,
                        summary: log.summary,
                        ipAddress: log.ipAddress,
                        userAgent: log.userAgent,
                        createdAt: log.originalCreatedAt,
                        actorRole: log.actorRole,
                        metadata: log.metadata,
                        actor:
                            log.actorUserId !== null
                                ? {
                                      id: log.actorUserId,
                                      username: log.actorUsername,
                                      role: log.actorRole,
                                  }
                                : null,
                    },
                    "archive",
                    log.archivedAt
                )
            ),
            source,
            total,
            page,
            pages: Math.max(1, Math.ceil(total / limit)),
            actionOptions: actionGroups.map((entry) => entry.action),
            resourceTypeOptions: resourceGroups.map((entry) => entry.resourceType),
            roleOptions: roleGroups.map((entry) => entry.actorRole),
        };
    }

    const where: Prisma.AuditLogWhereInput = {
        ...commonWhere,
        ...(search
            ? {
                  OR: [
                      { action: { contains: search } },
                      { resourceType: { contains: search } },
                      { resourceId: { contains: search } },
                      { summary: { contains: search } },
                      {
                          actor: {
                              is: {
                                  username: { contains: search },
                              },
                          },
                      },
                  ],
              }
            : {}),
    };
    const [logs, total, actionGroups, resourceGroups, roleGroups] =
        await Promise.all([
            prisma.auditLog.findMany({
                where,
                orderBy: [{ createdAt: "desc" }, { id: "desc" }],
                skip: (page - 1) * limit,
                take: limit,
                select: {
                    id: true,
                    action: true,
                    resourceType: true,
                    resourceId: true,
                    summary: true,
                    ipAddress: true,
                    userAgent: true,
                    createdAt: true,
                    actorRole: true,
                    metadata: true,
                    actor: {
                        select: {
                            id: true,
                            username: true,
                            role: true,
                        },
                    },
                },
            }),
            prisma.auditLog.count({ where }),
            prisma.auditLog.groupBy({
                by: ["action"],
                orderBy: { action: "asc" },
            }),
            prisma.auditLog.groupBy({
                by: ["resourceType"],
                orderBy: { resourceType: "asc" },
            }),
            prisma.auditLog.groupBy({
                by: ["actorRole"],
                orderBy: { actorRole: "asc" },
            }),
        ]);

    return {
        logs: logs.map((log) => mapAuditLog(log, "hot")),
        source,
        total,
        page,
        pages: Math.max(1, Math.ceil(total / limit)),
        actionOptions: actionGroups.map((entry) => entry.action),
        resourceTypeOptions: resourceGroups.map((entry) => entry.resourceType),
        roleOptions: roleGroups.map((entry) => entry.actorRole),
    };
}
