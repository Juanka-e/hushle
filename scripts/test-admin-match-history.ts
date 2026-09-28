import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { readFileSync } from "node:fs";
import { prisma } from "@hushle/platform-db";
import { prismaAuditRetentionStore } from "../apps/jobs/src/audit-retention";
import { adminMatchHistoryQuerySchema } from "../apps/web/src/lib/admin-match-history/schema";
import {
    getAdminUserMatchHistory,
    readMatchLineupIdentities,
} from "../apps/web/src/lib/admin-match-history/service";

assert.equal(adminMatchHistoryQuerySchema.parse({}).limit, 10);
assert.equal(adminMatchHistoryQuerySchema.parse({ page: "2" }).page, 2);
assert.throws(
    () => adminMatchHistoryQuerySchema.parse({ limit: 21 }),
    /Too big/
);
assert.equal(
    readMatchLineupIdentities({
        lineupIdentities: [
            {
                playerId: "p1",
                userId: 42,
                identityType: "registered",
                usernameSnapshot: "tester",
                displayNameSnapshot: "Tester",
                team: "A",
            },
            { invalid: true },
        ],
    }).length,
    1
);

const routeSource = readFileSync(
    "apps/web/src/app/api/admin/users/[id]/matches/route.ts",
    "utf8"
);
const finalizeSource = readFileSync(
    "apps/web/src/app/api/game/match/finalize/route.ts",
    "utf8"
);
assert.match(routeSource, /requireAdminSession/);
assert.match(routeSource, /consumeRequestRateLimit/);
assert.match(finalizeSource, /match_duration_seconds/);
assert.match(finalizeSource, /\$\{room\.matchFormat\}/);

async function main(): Promise<void> {
    if (process.env.ADMIN_MATCH_HISTORY_INTEGRATION_TEST !== "true") {
        throw new Error(
            "ADMIN_MATCH_HISTORY_INTEGRATION_TEST=true is required"
        );
    }

    const suffix = randomUUID().replaceAll("-", "").slice(0, 12);
    let userId: number | null = null;
    let matchId: number | null = null;
    let auditId: number | null = null;

    try {
        const user = await prisma.user.create({
            data: {
                username: `match_admin_${suffix}`,
                password: "integration-test-only",
            },
        });
        userId = user.id;

        const match = await prisma.matchResult.create({
            data: {
                roomCode: `M${suffix.slice(0, 5)}`.toUpperCase(),
                matchStartedAt: new Date("2026-07-01T12:00:00.000Z"),
                matchEndedAt: new Date("2026-07-01T12:03:00.000Z"),
                matchDurationSeconds: 180,
                matchFormat: "skor",
                matchTarget: 15,
                userId: user.id,
                playerId: `player-${suffix}`,
                team: "A",
                won: true,
                scoreA: 15,
                scoreB: 11,
                coinEarned: 80,
                lineupPlayerCount: 4,
                lineupAuthenticatedCount: 3,
                lineupGuestCount: 1,
            },
        });
        matchId = match.id;

        const audit = await prisma.auditLog.create({
            data: {
                actorUserId: user.id,
                actorRole: "user",
                action: "game.match.finalize",
                resourceType: "match_result",
                resourceId: String(match.id),
                summary: "Temporary match history integration record",
                metadata: {
                    requestedRewardCoin: 100,
                    allowedRewardCoin: 80,
                    blockedRewardCoin: 20,
                    rewardGuardTriggered: true,
                    rewardGuardBand: "soft_cap",
                    repeatedGroupTriggered: false,
                    eligibilityReasons: ["eligible"],
                    reviewFlags: ["fast_match"],
                    lineupIdentities: [
                        {
                            playerId: `player-${suffix}`,
                            userId: user.id,
                            identityType: "registered",
                            usernameSnapshot: user.username,
                            displayNameSnapshot: user.username,
                            team: "A",
                        },
                    ],
                },
                createdAt: new Date("2020-01-01T00:00:00.000Z"),
            },
        });
        auditId = audit.id;

        const query = adminMatchHistoryQuerySchema.parse({});
        const hotResult = await getAdminUserMatchHistory(user.id, query);
        assert.equal(hotResult?.total, 1);
        assert.equal(hotResult?.matches[0]?.matchDurationSeconds, 180);
        assert.equal(hotResult?.matches[0]?.matchFormat, "skor");
        assert.equal(hotResult?.matches[0]?.review?.auditSource, "hot");
        assert.equal(hotResult?.matches[0]?.review?.blockedRewardCoin, 20);
        assert.equal(hotResult?.summary.totalCoinEarned, 80);
        assert.equal(hotResult?.summary.durationSampleCount, 1);

        const moved = await prismaAuditRetentionStore.archiveAndDelete(
            [audit.id],
            new Date("2026-06-01T00:00:00.000Z")
        );
        assert.deepEqual(moved, { archivedCount: 1, deletedCount: 1 });

        const archivedResult = await getAdminUserMatchHistory(user.id, query);
        assert.equal(
            archivedResult?.matches[0]?.review?.auditSource,
            "archive"
        );
        assert.equal(
            archivedResult?.matches[0]?.review?.lineupIdentities.length,
            1
        );

        console.log("admin match history integration test passed");
    } finally {
        if (auditId !== null) {
            await prisma.auditLog.deleteMany({ where: { id: auditId } });
            await prisma.auditLogArchive.deleteMany({
                where: { originalAuditLogId: auditId },
            });
        }
        if (matchId !== null) {
            await prisma.matchResult.deleteMany({ where: { id: matchId } });
        }
        if (userId !== null) {
            await prisma.user.deleteMany({ where: { id: userId } });
        }
        await prisma.$disconnect();
    }
}

void main();
