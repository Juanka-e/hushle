import assert from "node:assert/strict";
import {
    clearPendingRoomAdminHandoff,
    getPendingRoomAdminHandoff,
    resetRoomAdminHandoffState,
    setPendingRoomAdminHandoff,
} from "../apps/web/src/lib/socket/room-admin-handoff";

const originalRedisUrl = process.env.REDIS_URL;

async function run(): Promise<void> {
    delete process.env.REDIS_URL;
    resetRoomAdminHandoffState();

    assert.equal(await getPendingRoomAdminHandoff("ROOM01"), null);

    const handoff = await setPendingRoomAdminHandoff("ROOM01", "user:17", 30_000);
    assert.equal(handoff.roomCode, "ROOM01");
    assert.equal(handoff.adminPlayerId, "user:17");
    assert.equal(typeof handoff.deadlineAt, "number");

    const stored = await getPendingRoomAdminHandoff("ROOM01");
    assert.equal(stored?.roomCode, "ROOM01");
    assert.equal(stored?.adminPlayerId, "user:17");
    assert.equal((stored?.deadlineAt ?? 0) >= handoff.deadlineAt - 5, true);

    await clearPendingRoomAdminHandoff("ROOM01", "user:99");
    assert.equal((await getPendingRoomAdminHandoff("ROOM01"))?.adminPlayerId, "user:17");

    await clearPendingRoomAdminHandoff("ROOM01", "user:17");
    assert.equal(await getPendingRoomAdminHandoff("ROOM01"), null);

    resetRoomAdminHandoffState();
    console.log("room admin handoff smoke test passed");
}

run()
    .catch((error) => {
        console.error(error);
        process.exitCode = 1;
    })
    .finally(() => {
        if (originalRedisUrl === undefined) {
            delete process.env.REDIS_URL;
        } else {
            process.env.REDIS_URL = originalRedisUrl;
        }
    });
