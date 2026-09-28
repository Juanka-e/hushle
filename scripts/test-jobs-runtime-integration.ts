import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { prisma } from "@hushle/platform-db";
import { prismaAuditRetentionStore } from "../apps/jobs/src/audit-retention";

async function main(): Promise<void> {
    if (process.env.JOBS_INTEGRATION_TEST !== "true") {
        throw new Error("JOBS_INTEGRATION_TEST=true is required");
    }

    const marker = `jobs.integration.${randomUUID()}`;
    let auditId: number | null = null;

    try {
        const audit = await prisma.auditLog.create({
            data: {
                actorRole: "system",
                action: marker.slice(0, 80),
                resourceType: "jobs_integration_test",
                summary: "Temporary audit retention integration record",
                createdAt: new Date("2020-01-01T00:00:00.000Z"),
            },
        });
        auditId = audit.id;

        const result = await prismaAuditRetentionStore.archiveAndDelete(
            [audit.id],
            new Date("2026-06-27T00:00:00.000Z")
        );

        assert.equal(result.archivedCount, 1);
        assert.equal(result.deletedCount, 1);
        assert.equal(
            await prisma.auditLog.count({ where: { id: audit.id } }),
            0
        );

        const archived = await prisma.auditLogArchive.findUnique({
            where: { originalAuditLogId: audit.id },
        });
        assert.equal(archived?.action, marker.slice(0, 80));
        assert.equal(
            archived?.originalCreatedAt.toISOString(),
            "2020-01-01T00:00:00.000Z"
        );

        console.log("jobs runtime integration test passed");
    } finally {
        if (auditId !== null) {
            await prisma.auditLog.deleteMany({ where: { id: auditId } });
            await prisma.auditLogArchive.deleteMany({
                where: { originalAuditLogId: auditId },
            });
        }
        await prisma.$disconnect();
    }
}

void main();
