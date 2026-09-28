import assert from "node:assert/strict";
import {
    claimOnlineRoomMembership,
    getOnlineRoomMembership,
    refreshOnlineRoomMembership,
    releaseOnlineRoomMembership,
    resetRoomMembershipState,
} from "../apps/web/src/lib/socket/room-membership";

const originalRedisUrl = process.env.REDIS_URL;

async function run(): Promise<void> {
    delete process.env.REDIS_URL;
    resetRoomMembershipState();

    assert.equal(await getOnlineRoomMembership(17), null);

    const firstClaim = await claimOnlineRoomMembership(17, "ROOM01");
    assert.equal(firstClaim.allowed, true);
    assert.equal(firstClaim.currentRoomCode, "ROOM01");
    assert.equal(await getOnlineRoomMembership(17), "ROOM01");

    const sameRoomClaim = await claimOnlineRoomMembership(17, "ROOM01");
    assert.equal(sameRoomClaim.allowed, true);
    assert.equal(sameRoomClaim.currentRoomCode, "ROOM01");

    const otherRoomClaim = await claimOnlineRoomMembership(17, "ROOM99");
    assert.equal(otherRoomClaim.allowed, false);
    assert.equal(otherRoomClaim.currentRoomCode, "ROOM01");

    await refreshOnlineRoomMembership(17, "ROOM01");
    assert.equal(await getOnlineRoomMembership(17), "ROOM01");

    await releaseOnlineRoomMembership(17, "ROOM99");
    assert.equal(await getOnlineRoomMembership(17), "ROOM01");

    await releaseOnlineRoomMembership(17, "ROOM01");
    assert.equal(await getOnlineRoomMembership(17), null);

    resetRoomMembershipState();
    console.log("room membership smoke test passed");
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
