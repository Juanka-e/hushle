import type { Prisma } from "@hushle/platform-db";
import { prisma } from "@/lib/prisma";
import { getRequestIp } from "@/lib/security/request-rate-limit";

type AuditMetadataValue = Prisma.InputJsonValue | null;
type AuditMetadata = { [key: string]: AuditMetadataValue };
type AuditMetadataEntry = [string, AuditMetadataValue];

export interface AuditActor {
    id: number | null;
    role: string;
}

export interface AuditLogInput {
    actor: AuditActor;
    action: string;
    resourceType: string;
    resourceId?: string | number | null;
    summary?: string | null;
    metadata?: AuditMetadata | null;
    request?: Request | null;
}

function normalizeMetadata(
    metadata: AuditMetadata | null | undefined
): AuditMetadata | null {
    if (!metadata) {
        return null;
    }

    const entries: AuditMetadataEntry[] = [];

    for (const [key, value] of Object.entries(metadata)) {
        const normalizedValue = normalizeMetadataValue(value);
        if (normalizedValue !== undefined) {
            entries.push([key, normalizedValue]);
        }
    }

    return entries.length > 0 ? Object.fromEntries(entries) : null;
}

function normalizeMetadataValue(value: unknown): AuditMetadataValue | undefined {
    if (
        value === null ||
        typeof value === "string" ||
        typeof value === "number" ||
        typeof value === "boolean"
    ) {
        return value;
    }

    if (Array.isArray(value)) {
        return value
            .map((entry) => normalizeMetadataValue(entry))
            .filter((entry): entry is AuditMetadataValue => entry !== undefined);
    }

    if (value && typeof value === "object") {
        const normalizedEntries = Object.entries(value)
            .map(([key, entryValue]) => {
                const normalizedEntryValue = normalizeMetadataValue(entryValue);
                return normalizedEntryValue === undefined
                    ? null
                    : ([key, normalizedEntryValue] as const);
            })
            .filter((entry): entry is readonly [string, AuditMetadataValue] => entry !== null);

        return Object.fromEntries(normalizedEntries);
    }

    return undefined;
}

function getUserAgent(request: Request | null | undefined): string | null {
    if (!request) {
        return null;
    }

    const userAgent = request.headers.get("user-agent");
    if (!userAgent) {
        return null;
    }

    return userAgent.slice(0, 255);
}

export async function writeAuditLog(input: AuditLogInput): Promise<void> {
    const { actor, action, resourceType, resourceId, summary, metadata, request } = input;
    const normalizedMetadata = normalizeMetadata(metadata);

    await prisma.auditLog.create({
        data: {
            actorUserId: actor.id,
            actorRole: actor.role.slice(0, 20),
            action: action.slice(0, 80),
            resourceType: resourceType.slice(0, 80),
            resourceId: resourceId !== undefined && resourceId !== null ? String(resourceId).slice(0, 120) : null,
            ipAddress: request ? getRequestIp(request).slice(0, 64) : null,
            userAgent: getUserAgent(request),
            summary: summary?.slice(0, 255) ?? null,
            metadata: normalizedMetadata ?? undefined,
        },
    });
}
