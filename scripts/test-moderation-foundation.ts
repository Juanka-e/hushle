import assert from "node:assert/strict";
import { isSuspensionActive } from "../apps/web/src/lib/moderation/service";
import {
    moderationActionSchema,
    moderationListQuerySchema,
} from "../apps/web/src/lib/moderation/schema";

assert.equal(
    isSuspensionActive({
        isSuspended: false,
        suspendedUntil: null,
    }),
    false
);

assert.equal(
    isSuspensionActive({
        isSuspended: true,
        suspendedUntil: null,
    }),
    true
);

assert.equal(
    isSuspensionActive({
        isSuspended: true,
        suspendedUntil: new Date(Date.now() - 5_000),
    }),
    false
);

assert.equal(
    isSuspensionActive({
        isSuspended: true,
        suspendedUntil: new Date(Date.now() + 5_000),
    }),
    true
);

const parsedSuspend = moderationActionSchema.parse({
    actionType: "suspend",
    reason: "Repeated abuse in lobby chat",
    suspendedUntil: new Date(Date.now() + 60_000).toISOString(),
});
assert.equal(parsedSuspend.actionType, "suspend");

const parsedNote = moderationActionSchema.parse({
    actionType: "note",
    reason: "User contacted support and requested review",
});
assert.equal(parsedNote.actionType, "note");

const parsedQuery = moderationListQuerySchema.parse({
    page: "2",
    limit: "10",
    status: "suspended",
    search: "ali",
});
assert.equal(parsedQuery.page, 2);
assert.equal(parsedQuery.limit, 10);
assert.equal(parsedQuery.status, "suspended");

const invalidReactivate = moderationActionSchema.safeParse({
    actionType: "reactivate",
    reason: "Appeal approved",
    suspendedUntil: new Date().toISOString(),
});
assert.equal(invalidReactivate.success, false);

console.log("moderation foundation tests passed");
