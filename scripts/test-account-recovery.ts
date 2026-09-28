import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import type { Server } from "socket.io";
import { parsePlayerProfilePatch, PlayerCoreError } from "@hushle/platform-player";
import {
    disconnectUserSockets,
    joinUserSessionRoom,
    registerSocketServer,
} from "../apps/web/src/lib/socket/user-session-control";

assert.throws(
    () =>
        parsePlayerProfilePatch({
            displayName: "Oyuncu",
            email: "unsafe@example.test",
        }),
    (error: unknown) =>
        error instanceof PlayerCoreError && error.code === "invalid_profile"
);

const passwordRequest = readFileSync(
    resolve(
        "apps/web/src/app/api/auth/password-reset/request/route.ts"
    ),
    "utf8"
);
assert.match(passwordRequest, /GENERIC_MESSAGE/);
assert.match(passwordRequest, /consumeDistributedRequestRateLimit/);
assert.match(passwordRequest, /isTrustedStateChangeRequest/);
assert.doesNotMatch(passwordRequest, /writeAuditLog/);

const passwordConfirm = readFileSync(
    resolve(
        "apps/web/src/app/api/auth/password-reset/confirm/route.ts"
    ),
    "utf8"
);
assert.match(passwordConfirm, /evaluatePasswordPolicy/);
assert.match(passwordConfirm, /checkPasswordBreach/);
assert.match(passwordConfirm, /disconnectUserSockets/);

const emailChangeRequest = readFileSync(
    resolve("apps/web/src/app/api/auth/email-change/request/route.ts"),
    "utf8"
);
assert.match(emailChangeRequest, /bcryptjs\.compare/);
assert.match(emailChangeRequest, /enqueueEmailChange/);
assert.match(emailChangeRequest, /consumeDistributedRequestRateLimit/);

const authSource = readFileSync(
    resolve("apps/web/src/lib/auth-shared.ts"),
    "utf8"
);
const sessionSource = readFileSync(
    resolve("apps/web/src/lib/session.ts"),
    "utf8"
);
assert.match(authSource, /token\.sessionVersion/);
assert.match(sessionSource, /user\.sessionVersion !== session\.user\.sessionVersion/);

let joinedRoom = "";
let disconnectedRoom = "";
registerSocketServer({
    in(room: string) {
        disconnectedRoom = room;
        return {
            disconnectSockets(force: boolean) {
                assert.equal(force, true);
            },
        };
    },
} as unknown as Server);
joinUserSessionRoom(
    {
        join(room) {
            joinedRoom = room;
        },
    },
    42
);
assert.equal(joinedRoom, "private:user-session:42");
void disconnectUserSockets(42)
    .then((disconnected) => {
        assert.equal(disconnected, true);
        assert.equal(disconnectedRoom, joinedRoom);
        console.log("account recovery security smoke test passed");
    })
    .catch((error) => {
        console.error(error);
        process.exitCode = 1;
    });
