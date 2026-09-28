import assert from "node:assert/strict";
import type { RoomOwnershipCoordinator } from "../apps/web/src/lib/socket/room-ownership";
import {
    ROOM_ROUTING_JOIN_ERROR,
    createRoomRouteResolver,
    shouldRejectRoomRoute,
    type RoomRouteDecisionKind,
} from "../apps/web/src/lib/socket/room-routing";

function createOwnershipStub(options: {
    enabled: boolean;
    instanceId?: string;
    getOwner: (roomCode: string) => Promise<string | null>;
}): RoomOwnershipCoordinator {
    const instanceId = options.instanceId ?? "instance-a";
    return {
        getConfig: () => ({
            enabled: options.enabled,
            leaseTtlMs: 30_000,
            renewIntervalMs: 10_000,
        }),
        getStatus: () => ({
            enabled: options.enabled,
            available: options.enabled,
            instanceId,
            leaseTtlMs: 30_000,
            renewIntervalMs: 10_000,
            trackedRooms: 0,
            ownedRooms: 0,
            lostRooms: 0,
            claimConflicts: 0,
            lostOwnerships: 0,
            renewFailures: 0,
            lastRenewedAt: null,
            enforcement: "create-only",
        }),
        claim: async () => ({ acquired: true, ownerInstanceId: instanceId }),
        getOwner: options.getOwner,
        renewOwnedRooms: async () => undefined,
        release: async () => undefined,
        close: async () => undefined,
    };
}

async function assertDecision(options: {
    owner: string | null;
    localRoomPresent: boolean;
    expected: RoomRouteDecisionKind;
}): Promise<void> {
    const resolver = createRoomRouteResolver(
        createOwnershipStub({
            enabled: true,
            getOwner: async () => options.owner,
        })
    );
    const decision = await resolver.resolve(
        "ROOM42",
        options.localRoomPresent
    );
    assert.equal(decision.kind, options.expected);
}

async function run(): Promise<void> {
    const disabled = createRoomRouteResolver(
        createOwnershipStub({
            enabled: false,
            getOwner: async () => {
                throw new Error("disabled routing must not read ownership");
            },
        })
    );
    assert.equal((await disabled.resolve("ROOM42", true)).kind, "local");
    assert.equal((await disabled.resolve("ROOM99", false)).kind, "missing");
    assert.equal(disabled.getStatus().decisions, 2);

    await assertDecision({
        owner: "instance-a",
        localRoomPresent: true,
        expected: "local",
    });
    await assertDecision({
        owner: null,
        localRoomPresent: false,
        expected: "missing",
    });
    await assertDecision({
        owner: "instance-b",
        localRoomPresent: false,
        expected: "remote-owner",
    });
    await assertDecision({
        owner: "instance-a",
        localRoomPresent: false,
        expected: "local-state-missing",
    });
    await assertDecision({
        owner: "instance-b",
        localRoomPresent: true,
        expected: "ownership-mismatch",
    });
    await assertDecision({
        owner: null,
        localRoomPresent: true,
        expected: "ownership-mismatch",
    });

    const unavailable = createRoomRouteResolver(
        createOwnershipStub({
            enabled: true,
            getOwner: async () => {
                throw new Error("simulated routing lookup failure");
            },
        })
    );
    const localUnavailable = await unavailable.resolve("ROOM42", true);
    assert.equal(localUnavailable.kind, "unavailable");
    assert.equal(shouldRejectRoomRoute(localUnavailable, true), false);
    assert.equal(shouldRejectRoomRoute(localUnavailable, false), true);
    assert.equal(unavailable.getStatus().available, false);
    assert.equal(unavailable.getStatus().lookupFailures, 1);
    assert.equal(unavailable.getStatus().routingReady, false);

    const remoteDecision = {
        kind: "remote-owner" as const,
    };
    assert.equal(shouldRejectRoomRoute(remoteDecision, false), true);
    assert.doesNotMatch(
        ROOM_ROUTING_JOIN_ERROR.toLocaleLowerCase("tr"),
        /instance|redis|owner|sunucu/
    );

    console.log("room routing decision test passed");
}

void run();
