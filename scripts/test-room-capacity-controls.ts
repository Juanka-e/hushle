import assert from "node:assert/strict";
import {
    resetRedisTestClient,
    setRedisTestClient,
    type RedisLikeClient,
} from "@hushle/platform-cache";
import { normalizeSystemSettings } from "../apps/web/src/lib/system-settings/schema";
import {
    canMoveToTeam,
    chooseJoinTeam,
    evaluateCapacityAdmission,
    getEffectiveRoomMaxPlayers,
    getEffectiveTeamMaxPlayers,
    resolveRoomStartDecision,
    type RoomRulePlayer,
} from "../apps/web/src/lib/socket/room-capacity-policy";
import {
    getCapacityClusterSnapshot,
    publishCapacityHeartbeat,
    removeCapacityHeartbeat,
} from "../apps/web/src/lib/socket/room-capacity";

type StoredValue = {
    value: string;
    expiresAt: number | null;
};

class FakeCapacityRedis implements RedisLikeClient {
    private readonly values = new Map<string, StoredValue>();
    private readonly sets = new Map<string, Set<string>>();

    async ping(): Promise<string> {
        return "PONG";
    }

    private cleanup(key: string): void {
        const value = this.values.get(key);
        if (
            value?.expiresAt !== null &&
            value?.expiresAt !== undefined &&
            value.expiresAt <= Date.now()
        ) {
            this.values.delete(key);
        }
    }

    async get(key: string): Promise<string | null> {
        this.cleanup(key);
        return this.values.get(key)?.value ?? null;
    }

    async mGet(keys: string[]): Promise<Array<string | null>> {
        return Promise.all(keys.map((key) => this.get(key)));
    }

    async set(
        key: string,
        value: string,
        options?: { PX?: number; NX?: boolean }
    ): Promise<string | null> {
        this.cleanup(key);
        if (options?.NX && this.values.has(key)) return null;
        this.values.set(key, {
            value,
            expiresAt:
                typeof options?.PX === "number"
                    ? Date.now() + options.PX
                    : null,
        });
        return "OK";
    }

    async del(key: string): Promise<number> {
        this.cleanup(key);
        return this.values.delete(key) ? 1 : 0;
    }

    async incr(key: string): Promise<number> {
        const current = Number.parseInt((await this.get(key)) ?? "0", 10);
        const next = current + 1;
        await this.set(key, String(next));
        return next;
    }

    async pExpire(key: string, milliseconds: number): Promise<number> {
        this.cleanup(key);
        const current = this.values.get(key);
        if (!current) return 0;
        current.expiresAt = Date.now() + milliseconds;
        return 1;
    }

    async pTTL(key: string): Promise<number> {
        this.cleanup(key);
        const current = this.values.get(key);
        if (!current) return -2;
        if (current.expiresAt === null) return -1;
        return Math.max(0, current.expiresAt - Date.now());
    }

    async sAdd(key: string, member: string): Promise<number> {
        const members = this.sets.get(key) ?? new Set<string>();
        const sizeBefore = members.size;
        members.add(member);
        this.sets.set(key, members);
        return members.size > sizeBefore ? 1 : 0;
    }

    async sRem(key: string, member: string): Promise<number> {
        return this.sets.get(key)?.delete(member) ? 1 : 0;
    }

    async sMembers(key: string): Promise<string[]> {
        return [...(this.sets.get(key) ?? new Set<string>())];
    }

    async eval(): Promise<number> {
        return 0;
    }
}

function player(
    identityType: "registered" | "guest",
    team: "A" | "B" | null,
    role = "Oyuncu"
): RoomRulePlayer {
    return {
        identityType,
        team,
        role,
        online: true,
    };
}

async function run(): Promise<void> {
    const settings = normalizeSystemSettings({});
    assert.equal(
        getEffectiveRoomMaxPlayers({
            ...settings.capacity,
            roomMaxPlayers: 2,
        }),
        4
    );
    assert.equal(
        getEffectiveTeamMaxPlayers({
            ...settings.capacity,
            teamMaxPlayers: 1,
        }),
        2
    );

    const guestPair = resolveRoomStartDecision([
        player("guest", "A"),
        player("guest", "B"),
    ]);
    assert.equal(guestPair.allowed, false);
    assert.equal(guestPair.minimumPlayers, 4);

    const registeredThree = resolveRoomStartDecision([
        player("registered", "A"),
        player("guest", "A"),
        player("guest", "B"),
    ]);
    assert.equal(registeredThree.allowed, false);
    assert.equal(registeredThree.minimumPlayers, 4);

    assert.equal(
        resolveRoomStartDecision([
            player("registered", "A"),
            player("guest", "A"),
            player("guest", "B"),
            player("guest", "B"),
            player("registered", null, "İzleyici"),
        ]).allowed,
        true
    );

    const unbalancedFour = resolveRoomStartDecision([
        player("guest", "A"),
        player("guest", "A"),
        player("guest", "A"),
        player("guest", "B"),
    ]);
    assert.equal(unbalancedFour.allowed, false);
    assert.match(unbalancedFour.message ?? "", /en az 2 aktif oyuncu/i);

    assert.equal(
        resolveRoomStartDecision([
            player("guest", "A"),
            player("guest", "A"),
            player("guest", "B"),
            player("guest", "B"),
        ]).allowed,
        true
    );

    assert.equal(
        chooseJoinTeam(
            [
                player("guest", "A"),
                player("guest", "A"),
                player("guest", "B"),
            ],
            settings.capacity
        ),
        "B"
    );

    const fullTeam = Array.from({ length: settings.capacity.teamMaxPlayers }, () =>
        player("guest", "B")
    );
    assert.equal(canMoveToTeam(fullTeam, "B", settings.capacity), false);
    assert.equal(
        chooseJoinTeam(
            [
                ...fullTeam,
                ...Array.from(
                    { length: settings.capacity.teamMaxPlayers },
                    () => player("guest", "A")
                ),
            ],
            settings.capacity
        ),
        null
    );

    const warning = evaluateCapacityAdmission(
        { activeRooms: 375, onlinePlayers: 100 },
        settings.capacity
    );
    assert.equal(warning.level, "warning");
    assert.equal(warning.allowCreate, true);

    const critical = evaluateCapacityAdmission(
        { activeRooms: 450, onlinePlayers: 100 },
        settings.capacity
    );
    assert.equal(critical.level, "critical");
    assert.equal(critical.allowCreate, false);
    assert.equal(critical.allowJoin, true);

    const roomCapacityReached = evaluateCapacityAdmission(
        { activeRooms: 500, onlinePlayers: 100 },
        settings.capacity
    );
    assert.equal(roomCapacityReached.level, "critical");
    assert.equal(roomCapacityReached.allowCreate, false);
    assert.equal(roomCapacityReached.allowJoin, true);

    const playerCapacityClosed = evaluateCapacityAdmission(
        { activeRooms: 100, onlinePlayers: 5_000 },
        settings.capacity
    );
    assert.equal(playerCapacityClosed.level, "closed");
    assert.equal(playerCapacityClosed.allowJoin, false);

    const forcedOpenAtHardLimit = evaluateCapacityAdmission(
        { activeRooms: 100, onlinePlayers: 5_000 },
        {
            ...settings.capacity,
            admissionMode: "open",
        }
    );
    assert.equal(forcedOpenAtHardLimit.allowJoin, false);

    const originalRedisUrl = process.env.REDIS_URL;
    const originalPrefix = process.env.REDIS_KEY_PREFIX;
    process.env.REDIS_URL = "redis://capacity-test";
    process.env.REDIS_KEY_PREFIX = "hushle:test:capacity";
    setRedisTestClient(new FakeCapacityRedis());

    try {
        await publishCapacityHeartbeat({
            activeRooms: 4,
            activeMatches: 2,
            onlinePlayers: 11,
            spectators: 1,
            connectedSockets: 13,
        });
        const cluster = await getCapacityClusterSnapshot();
        assert.equal(cluster.source, "redis");
        assert.equal(cluster.activeInstances, 1);
        assert.equal(cluster.activeRooms, 4);
        assert.equal(cluster.activeMatches, 2);
        assert.equal(cluster.onlinePlayers, 11);
        assert.equal(cluster.spectators, 1);
        assert.equal(cluster.connectedSockets, 13);

        const fresherLocalCluster = await getCapacityClusterSnapshot({
            activeRooms: 5,
            activeMatches: 3,
            onlinePlayers: 14,
            spectators: 2,
            connectedSockets: 16,
        });
        assert.equal(fresherLocalCluster.activeInstances, 1);
        assert.equal(fresherLocalCluster.activeRooms, 5);
        assert.equal(fresherLocalCluster.onlinePlayers, 14);

        await removeCapacityHeartbeat();
    } finally {
        resetRedisTestClient();
        if (originalRedisUrl === undefined) delete process.env.REDIS_URL;
        else process.env.REDIS_URL = originalRedisUrl;
        if (originalPrefix === undefined) delete process.env.REDIS_KEY_PREFIX;
        else process.env.REDIS_KEY_PREFIX = originalPrefix;
    }

    console.log("room capacity controls smoke test passed");
}

void run();
