import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { prisma } from "@hushle/platform-db";
import { prismaAuditRetentionStore } from "../apps/jobs/src/audit-retention";
import { adminAuditListQuerySchema } from "../apps/web/src/lib/admin-audit/schema";
import { getAdminAuditLogs } from "../apps/web/src/lib/admin-audit/service";

async function main(): Promise<void> {
    if (process.env.AUDIT_ARCHIVE_INTEGRATION_TEST !== "true") {
        throw new Error("AUDIT_ARCHIVE_INTEGRATION_TEST=true is required");
    }

    const suffix = randomUUID().replaceAll("-", "").slice(0, 16);
    const username = `archive_admin_${suffix}`;
    const action = `archive.integration.${suffix}`;
    let userId: number | null = null;
    let auditId: number | null = null;

    try {
        const user = await prisma.user.create({
            data: {
                username,
                password: "integration-test-only",
                role: "admin",
            },
        });
        userId = user.id;

        const audit = await prisma.auditLog.create({
            data: {
                actorUserId: user.id,
                actorRole: user.role,
                action,
                resourceType: "audit_archive_integration",
                summary: "Temporary admin archive read-path record",
                metadata: { marker: suffix },
                createdAt: new Date("2020-01-01T00:00:00.000Z"),
            },
        });
        auditId = audit.id;

        const moved = await prismaAuditRetentionStore.archiveAndDelete(
            [audit.id],
            new Date("2026-06-27T00:00:00.000Z")
        );
        assert.deepEqual(moved, { archivedCount: 1, deletedCount: 1 });

        const archiveResult = await getAdminAuditLogs(
            adminAuditListQuerySchema.parse({
                source: "archive",
                action,
                search: username,
            })
        );
        assert.equal(archiveResult.source, "archive");
        assert.equal(archiveResult.total, 1);
        assert.equal(archiveResult.logs[0]?.source, "archive");
        assert.equal(archiveResult.logs[0]?.id, audit.id);
        assert.equal(archiveResult.logs[0]?.actor?.id, user.id);
        assert.equal(archiveResult.logs[0]?.actor?.username, username);
        assert.ok(archiveResult.logs[0]?.archivedAt);

        const hotResult = await getAdminAuditLogs(
            adminAuditListQuerySchema.parse({ source: "hot", action })
        );
        assert.equal(hotResult.total, 0);

        console.log("admin audit archive integration test passed");
    } finally {
        if (auditId !== null) {
            await prisma.auditLog.deleteMany({ where: { id: auditId } });
            await prisma.auditLogArchive.deleteMany({
                where: { originalAuditLogId: auditId },
            });
        }
        if (userId !== null) {
            await prisma.user.deleteMany({ where: { id: userId } });
        }
        await prisma.$disconnect();
    }
}

void main();
