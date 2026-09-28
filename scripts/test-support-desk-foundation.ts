import assert from "node:assert/strict";
import {
    supportAdminListQuerySchema,
    supportTicketAdminMessageSchema,
    supportTicketAdminUpdateSchema,
    supportTicketCreateSchema,
    supportTicketReplySchema,
} from "../apps/web/src/lib/support/schema";
import {
    getSupportStatusAfterAdminMessage,
    getSupportStatusAfterUserReply,
    SUPPORT_TICKET_REPLY_COOLDOWN_SECONDS,
} from "../apps/web/src/lib/support/service";

const createInput = supportTicketCreateSchema.parse({
    category: "gameplay",
    subject: "Kart tema sorunu",
    message: "Kart temasi oyunda bekledigim gibi gorunmuyor.",
});

assert.equal(createInput.category, "gameplay");
assert.equal(createInput.subject, "Kart tema sorunu");

const replyInput = supportTicketReplySchema.parse({
    body: "Ek log ve ekran goruntusunu paylastim.",
});
assert.equal(replyInput.body, "Ek log ve ekran goruntusunu paylastim.");

const adminUpdate = supportTicketAdminUpdateSchema.parse({
    status: "resolved",
    priority: "high",
    assignedAdminUserId: 4,
});
assert.equal(adminUpdate.status, "resolved");
assert.equal(adminUpdate.priority, "high");
assert.equal(adminUpdate.assignedAdminUserId, 4);

const adminMessage = supportTicketAdminMessageSchema.parse({
    body: "Sorun yeniden uretildi, patch hazirlaniyor.",
    isInternal: true,
});
assert.equal(adminMessage.isInternal, true);

const adminListQuery = supportAdminListQuerySchema.parse({
    page: "2",
    limit: "12",
    search: "tema",
    status: "in_progress",
});
assert.equal(adminListQuery.page, 2);
assert.equal(adminListQuery.limit, 12);
assert.equal(adminListQuery.search, "tema");
assert.equal(adminListQuery.status, "in_progress");

assert.equal(getSupportStatusAfterUserReply("open"), "open");
assert.equal(getSupportStatusAfterUserReply("resolved"), null);
assert.equal(getSupportStatusAfterUserReply("closed"), null);
assert.equal(SUPPORT_TICKET_REPLY_COOLDOWN_SECONDS, 30);

assert.equal(getSupportStatusAfterAdminMessage("open", false), "in_progress");
assert.equal(getSupportStatusAfterAdminMessage("resolved", false), "in_progress");
assert.equal(getSupportStatusAfterAdminMessage("closed", false), null);
assert.equal(getSupportStatusAfterAdminMessage("closed", true), "closed");

console.log("support desk foundation smoke test passed");
