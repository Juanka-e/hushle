import assert from "node:assert/strict";
import { closeRedisClient } from "@hushle/platform-cache";
import { createRoomOwnershipCoordinator } from "../apps/web/src/lib/socket/room-ownership";
import { createRoomRouteResolver } from "../apps/web/src/lib/socket/room-routing";

async function run(): Promise<void> {
    assert.equal(
        process.env.ROOM_OWNERSHIP_REDIS_TEST,
        "true",
        "ROOM_OWNERSHIP_REDIS_TEST=true is required"
    );
    assert.ok(process.env.REDIS_URL?.trim(), "REDIS_URL is required");

    const env = {
        ROOM_OWNERSHIP_LEASE_ENABLED: "true",
        ROOM_OWNERSHIP_LEASE_TTL_MS: "30000",
        ROOM_OWNERSHIP_RENEW_INTERVAL_MS: "10000",
    };
    const first = await createRoomOwnershipCoordinator({
        instanceId: "redis-integration-a",
        env,
    });
    const second = await createRoomOwnershipCoordinator({
        instanceId: "redis-integration-b",
        env,
    });
    const secondRouting = createRoomRouteResolver(second);
    const roomCode = `R${Date.now().toString(36).slice(-5)}`.toUpperCase();

    try {
        assert.equal((await first.claim(roomCode)).acquired, true);
        assert.deepEqual(await second.claim(roomCode), {
            acquired: false,
            ownerInstanceId: "redis-integration-a",
        });
        assert.equal(
            (await secondRouting.resolve(roomCode, false)).kind,
            "remote-owner"
        );
        await first.renewOwnedRooms();
        assert.equal(first.getStatus().ownedRooms, 1);

        await first.release(roomCode);
        assert.equal((await second.claim(roomCode)).acquired, true);
        assert.equal(
            (await secondRouting.resolve(roomCode, true)).kind,
            "local"
        );
        assert.equal(await first.getOwner(roomCode), "redis-integration-b");

        console.log("room ownership Redis integration test passed");
    } finally {
        await Promise.allSettled([first.close(), second.close()]);
        await closeRedisClient();
    }
}

void run();
