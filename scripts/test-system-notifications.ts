import { notificationListQuerySchema, notificationParamsSchema } from "../apps/web/src/lib/notifications/schema";
import { shouldCreateSupportStatusNotification } from "../apps/web/src/lib/notifications/service";

const unreadQuery = notificationListQuerySchema.parse({
    limit: "30",
    filter: "unread",
});

if (unreadQuery.limit !== 30 || unreadQuery.filter !== "unread") {
    throw new Error("Notification query parsing failed.");
}

const defaultQuery = notificationListQuerySchema.parse({});
if (defaultQuery.limit !== 20 || defaultQuery.filter !== "all") {
    throw new Error("Notification query defaults are incorrect.");
}

const params = notificationParamsSchema.parse({ id: "12" });
if (params.id !== 12) {
    throw new Error("Notification params parsing failed.");
}

if (!shouldCreateSupportStatusNotification("in_progress", "resolved")) {
    throw new Error("Resolved support tickets should notify the user.");
}

if (!shouldCreateSupportStatusNotification("resolved", "closed")) {
    throw new Error("Closed support tickets should notify the user.");
}

if (shouldCreateSupportStatusNotification("open", "in_progress")) {
    throw new Error("In-progress support updates should not notify the user.");
}

if (shouldCreateSupportStatusNotification("resolved", "resolved")) {
    throw new Error("Unchanged support status should not notify the user.");
}

console.log("system notifications foundation smoke test passed");
