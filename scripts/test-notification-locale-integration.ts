import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { prisma } from "@hushle/platform-db";
import {
    createUserNotificationWithClient,
    listNotificationsForUser,
} from "../apps/web/src/lib/notifications/service";
import { notificationTemplate } from "../apps/web/src/lib/notifications/templates";

// The notification list renders templated rows in the reader's locale and keeps
// the stored text for rows without a template (every row written before this).
async function run(): Promise<void> {
    assert.equal(process.env.NOTIFICATION_LOCALE_INTEGRATION_TEST, "true", "NOTIFICATION_LOCALE_INTEGRATION_TEST=true is required");
    assert.match(process.env.DATABASE_URL ?? "", /tabu_test/, "A disposable tabu_test database is required");

    const suffix = randomUUID().replaceAll("-", "").slice(0, 12);
    const user = await prisma.user.create({
        data: { username: `notify_locale_${suffix}`, password: "integration-test-only" },
    });

    try {
        await createUserNotificationWithClient(prisma, {
            userId: user.id,
            type: "economy",
            title: "Satın alma tamamlandı",
            body: "Pulse Fox envanterine eklendi. LAUNCH10 kuponu uygulandı.",
            resourceType: "shop_item",
            resourceId: 1,
            actionLabel: "Envanteri Aç",
            actionHref: "/dashboard?tab=inventory",
            metadata: {
                template: notificationTemplate("itemPurchased", { item: "Pulse Fox", coupon: "LAUNCH10" }),
                kind: "store_purchase",
            },
        });
        await createUserNotificationWithClient(prisma, {
            userId: user.id,
            type: "support_reply",
            title: "Destek ekibinden yeni cevap var",
            body: "Merhaba, hesabındaki sorunu çözdük.",
            resourceType: "support_ticket",
            resourceId: 7,
            actionLabel: "Yardım merkezinde aç",
            metadata: { template: notificationTemplate("supportReply") },
        });
        // A row written before templates existed, and one whose template is broken.
        await prisma.notification.create({
            data: {
                userId: user.id,
                type: "system",
                title: "Eski bildirim",
                body: "Şablonsuz kayıt.",
                metadata: { kind: "legacy" },
            },
        });
        await prisma.notification.create({
            data: {
                userId: user.id,
                type: "system",
                title: "Bozuk şablon",
                body: "Şablon kimliği bilinmiyor.",
                metadata: { template: { id: "noSuchTemplate", params: { item: "X" } } },
            },
        });

        const query = { limit: 10, filter: "all" as const };
        const byTitle = (list: Awaited<ReturnType<typeof listNotificationsForUser>>) =>
            new Map(list.notifications.map((entry) => [entry.title, entry]));

        const english = byTitle(await listNotificationsForUser(user.id, query, "en"));
        assert.deepEqual(
            [...english.keys()].sort(),
            ["Bozuk şablon", "Eski bildirim", "New reply from the support team", "Purchase complete"].sort()
        );
        const purchase = english.get("Purchase complete")!;
        assert.equal(purchase.body, "Pulse Fox was added to your inventory. Coupon LAUNCH10 was applied.");
        assert.equal(purchase.actionLabel, "Open Inventory");
        assert.equal(purchase.actionHref, "/dashboard?tab=inventory");
        const reply = english.get("New reply from the support team")!;
        assert.equal(reply.body, "Merhaba, hesabındaki sorunu çözdük.", "staff text is not translated");
        assert.equal(reply.actionLabel, "Open in Help Center");
        assert.equal(english.get("Eski bildirim")!.body, "Şablonsuz kayıt.");
        assert.equal(english.get("Bozuk şablon")!.body, "Şablon kimliği bilinmiyor.");

        const turkish = byTitle(await listNotificationsForUser(user.id, query, "tr"));
        assert.equal(turkish.get("Satın alma tamamlandı")!.body, "Pulse Fox envanterine eklendi. LAUNCH10 kuponu uygulandı.");
        assert.equal(turkish.get("Destek ekibinden yeni cevap var")!.actionLabel, "Yardım merkezinde aç");

        // Without a locale the list keeps the default (Turkish).
        const fallback = byTitle(await listNotificationsForUser(user.id, query));
        assert.ok(fallback.has("Satın alma tamamlandı"));

        // The stored rows stay Turkish for admin and audit views.
        const rows = await prisma.notification.findMany({ where: { userId: user.id }, select: { title: true } });
        assert.ok(rows.some((row) => row.title === "Satın alma tamamlandı"));
        assert.ok(!rows.some((row) => row.title === "Purchase complete"));

        console.log("notification locale integration test passed");
    } finally {
        await prisma.notification.deleteMany({ where: { userId: user.id } });
        await prisma.user.delete({ where: { id: user.id } });
        await prisma.$disconnect();
    }
}

run().catch((error) => {
    console.error(error);
    process.exit(1);
});
