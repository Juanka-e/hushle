import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import type { RoomMatchSnapshot } from "../apps/web/src/lib/socket/game-socket";
import {
    SettlementSnapshotError,
    createSettlementSnapshot,
    getRegisteredParticipants,
    parseSettlementSnapshot,
    toRewardRoomSnapshot,
} from "../apps/web/src/lib/match-settlement/snapshot";
import {
    MATCH_SETTLEMENT_CLAIM_TTL_MS,
    MATCH_SETTLEMENT_MAX_ATTEMPTS,
    formatSettlementError,
    getSettlementRetryDelayMs,
} from "../apps/web/src/lib/match-settlement/retry-policy";
import { createSettlementQueue } from "../apps/web/src/lib/match-settlement/queue";
import { createSettlementWorker } from "../apps/web/src/lib/match-settlement/worker";

function endedRoom(overrides: Partial<RoomMatchSnapshot> = {}): RoomMatchSnapshot {
    return {
        odaKodu: "ABC123",
        gameMode: "tabu",
        oyunAktifMi: false,
        skor: { A: 10, B: 7 },
        matchStartedAt: "2026-10-12T10:00:00.123Z",
        matchEndedAt: "2026-10-12T10:20:00.456Z",
        sureSeconds: 1140,
        matchFormat: "skor",
        matchTarget: 10,
        matchEndReason: "completed",
        oyuncular: [
            { playerId: "p-host", userId: 11, identityType: "registered", usernameSnapshot: "host", ad: "Host", takim: "A", roleAtStart: "Anlatıcı" },
            { playerId: "p-guest-a", userId: null, identityType: "guest", usernameSnapshot: null, ad: "Misafir A", takim: "A", roleAtStart: "Tahminci" },
            { playerId: "p-reg-b", userId: 12, identityType: "registered", usernameSnapshot: "bob", ad: "Bob", takim: "B", roleAtStart: "Gözetmen" },
            { playerId: "p-guest-b", userId: null, identityType: "guest", usernameSnapshot: null, ad: "Misafir B", takim: "B", roleAtStart: "Oyuncu" },
        ],
        ...overrides,
    };
}

// 1. Ended room -> versioned snapshot with every participant, guests included.
const snapshot = createSettlementSnapshot(endedRoom(), "completed");
assert.equal(snapshot.version, 1);
assert.equal(snapshot.endReason, "completed");
assert.equal(snapshot.roomCode, "ABC123");
assert.equal(snapshot.gameMode, "tabu");
assert.equal(snapshot.matchStartedAt, "2026-10-12T10:00:00.123Z");
assert.equal(snapshot.matchEndedAt, "2026-10-12T10:20:00.456Z");
assert.equal(snapshot.durationSeconds, 1140);
assert.deepEqual(snapshot.score, { A: 10, B: 7 });
assert.equal(snapshot.participants.length, 4);
assert.deepEqual(snapshot.participants[1], {
    playerId: "p-guest-a",
    userId: null,
    identityType: "guest",
    usernameSnapshot: null,
    displayName: "Misafir A",
    team: "A",
    roleAtStart: "Tahminci",
});
assert.equal("oyunAktifMi" in snapshot, false);
assert.doesNotMatch(JSON.stringify(snapshot), /"ip(?:Address)?"\s*:/i, "snapshot must not carry IP fields");
assert.equal(createSettlementSnapshot(endedRoom(), "host_ended").endReason, "host_ended");

// 1b. Cosmetic labels are normalized instead of failing the whole match.
{
    const room = endedRoom();
    room.oyuncular = [
        { ...room.oyuncular[0], ad: "x".repeat(80), usernameSnapshot: "u".repeat(80) },
        { ...room.oyuncular[1], ad: "   " },
        { ...room.oyuncular[2], usernameSnapshot: "" },
    ];
    const normalized = createSettlementSnapshot(room, "completed");
    assert.equal(normalized.participants[0].displayName.length, 64);
    assert.equal(normalized.participants[0].usernameSnapshot?.length, 64);
    assert.equal(normalized.participants[1].displayName, "Oyuncu");
    assert.equal(normalized.participants[2].usernameSnapshot, null);
}

// 2. Only finished matches can be snapshotted.
assert.throws(() => createSettlementSnapshot(endedRoom({ oyunAktifMi: true }), "completed"), SettlementSnapshotError);
assert.throws(() => createSettlementSnapshot(endedRoom({ matchStartedAt: null }), "completed"), SettlementSnapshotError);
assert.throws(() => createSettlementSnapshot(endedRoom({ matchEndedAt: null }), "completed"), SettlementSnapshotError);
assert.throws(
    () => createSettlementSnapshot(endedRoom({ matchEndedAt: "2026-10-12T09:00:00.000Z" }), "completed"),
    SettlementSnapshotError,
    "end before start must be rejected"
);

// 3. Parse round-trips, including through JSON (the DB stores JSON).
assert.deepEqual(parseSettlementSnapshot(snapshot), snapshot);
assert.deepEqual(parseSettlementSnapshot(JSON.parse(JSON.stringify(snapshot))), snapshot);
assert.deepEqual(
    parseSettlementSnapshot({ ...snapshot, durationSeconds: null }).durationSeconds,
    null
);
assert.equal(parseSettlementSnapshot({ ...snapshot, participants: [] }).participants.length, 0);

// 4. Parse rejects malformed or tampered snapshots.
const invalidSnapshots: Array<[string, unknown]> = [
    ["null", null],
    ["future version", { ...snapshot, version: 2 }],
    ["extra key", { ...snapshot, ip: "203.0.113.5" }],
    ["participant extra key", { ...snapshot, participants: [{ ...snapshot.participants[0], ip: "203.0.113.5" }] }],
    ["zero userId", { ...snapshot, participants: [{ ...snapshot.participants[0], userId: 0 }] }],
    ["negative userId", { ...snapshot, participants: [{ ...snapshot.participants[0], userId: -4 }] }],
    ["float userId", { ...snapshot, participants: [{ ...snapshot.participants[0], userId: 1.5 }] }],
    ["string userId", { ...snapshot, participants: [{ ...snapshot.participants[0], userId: "11" }] }],
    ["registered without userId", { ...snapshot, participants: [{ ...snapshot.participants[0], userId: null }] }],
    ["guest with userId", { ...snapshot, participants: [{ ...snapshot.participants[1], userId: 99 }] }],
    ["bad team", { ...snapshot, participants: [{ ...snapshot.participants[0], team: "C" }] }],
    ["bad role", { ...snapshot, participants: [{ ...snapshot.participants[0], roleAtStart: "Hakem" }] }],
    ["empty playerId", { ...snapshot, participants: [{ ...snapshot.participants[0], playerId: "" }] }],
    ["empty room code", { ...snapshot, roomCode: "" }],
    ["lowercase room code", { ...snapshot, roomCode: "abc123" }],
    ["too many participants", { ...snapshot, participants: Array.from({ length: 41 }, (_, i) => ({ ...snapshot.participants[1], playerId: `g${i}` })) }],
    ["non ISO start", { ...snapshot, matchStartedAt: "yesterday" }],
    ["end before start", { ...snapshot, matchEndedAt: "2026-10-12T09:00:00.000Z" }],
    ["negative score", { ...snapshot, score: { A: -1, B: 0 } }],
    ["float score", { ...snapshot, score: { A: 1.5, B: 0 } }],
    ["negative duration", { ...snapshot, durationSeconds: -3 }],
    ["unknown end reason", { ...snapshot, endReason: "abandoned" }],
    ["unknown format", { ...snapshot, matchFormat: "zaman" }],
    ["unknown game mode", { ...snapshot, gameMode: "pictionary" }],
];
for (const [label, value] of invalidSnapshots) {
    assert.throws(() => parseSettlementSnapshot(value), SettlementSnapshotError, `must reject: ${label}`);
}

// 5. Registered participants: positive integer ids, deduplicated, guests ignored.
const duplicated = parseSettlementSnapshot({
    ...snapshot,
    participants: [
        ...snapshot.participants,
        { ...snapshot.participants[0], playerId: "p-host-second-tab" },
    ],
});
assert.deepEqual(
    getRegisteredParticipants(duplicated).map((participant) => [participant.userId, participant.playerId]),
    [[11, "p-host"], [12, "p-reg-b"]]
);
assert.deepEqual(getRegisteredParticipants({ ...snapshot, participants: [] }), []);

// 6. Reward pipeline input mirrors the live room snapshot shape.
const rewardRoom = toRewardRoomSnapshot(snapshot);
assert.equal(rewardRoom.oyunAktifMi, false);
assert.equal(rewardRoom.odaKodu, "ABC123");
assert.equal(rewardRoom.sureSeconds, 1140);
assert.deepEqual(rewardRoom.oyuncular, endedRoom().oyuncular);

// 7. Retry policy.
assert.equal(MATCH_SETTLEMENT_MAX_ATTEMPTS, 10);
assert.equal(MATCH_SETTLEMENT_CLAIM_TTL_MS, 60_000);
assert.deepEqual(
    [0, -2, 1, 2, 3, 4, 5, 6, 7, 8, 9, 50].map(getSettlementRetryDelayMs),
    [15_000, 15_000, 15_000, 30_000, 60_000, 120_000, 300_000, 600_000, 900_000, 1_800_000, 1_800_000, 1_800_000]
);

// 8. Stored error text is one bounded line.
assert.equal(formatSettlementError(new Error("boom")), "Error: boom");
assert.equal(formatSettlementError("plain failure"), "plain failure");
assert.equal(formatSettlementError({ code: "P2002" }), "{\"code\":\"P2002\"}");
assert.equal(formatSettlementError(new TypeError("line one\n  line two")), "TypeError: line one line two");
assert.equal(formatSettlementError(undefined), "Unknown settlement error");
assert.equal(formatSettlementError(new Error("x".repeat(1000))).length, 255);

function snapshotFor(code: string, startedAt = "2026-10-12T10:00:00.000Z") {
    return createSettlementSnapshot(endedRoom({ odaKodu: code, matchStartedAt: startedAt }), "completed");
}

async function queueAndWorkerChecks(): Promise<void> {
    // Q1. Healthy path: record then settle once, nothing buffered.
    {
        const calls: string[] = [];
        const queue = createSettlementQueue({
            record: async (value) => { calls.push(`record:${value.roomCode}`); return { id: 7 }; },
            settle: async (id) => { calls.push(`settle:${id}`); },
        });
        await queue.enqueue(snapshotFor("QONE01"));
        assert.deepEqual(calls, ["record:QONE01", "settle:7"]);
        assert.equal(queue.size(), 0);
    }

    // Q2. Record failure buffers the snapshot and retries only when due.
    {
        let clock = 1_000_000;
        let failRecord = true;
        const recorded: string[] = [];
        const settled: number[] = [];
        const errors: string[] = [];
        const queue = createSettlementQueue({
            now: () => clock,
            record: async (value) => {
                if (failRecord) throw new Error("db down");
                recorded.push(value.roomCode);
                return { id: 9 };
            },
            settle: async (id) => { settled.push(id); },
            onError: (event) => errors.push(event),
        });
        await queue.enqueue(snapshotFor("QTWO02"));
        assert.equal(queue.size(), 1);
        assert.deepEqual(settled, []);
        assert.deepEqual(errors, ["match_settlement.record.failed"]);
        failRecord = false;
        assert.equal(await queue.flushDue(), 0, "not due yet");
        assert.deepEqual(recorded, []);
        clock += 15_000;
        assert.equal(await queue.flushDue(), 1);
        assert.deepEqual(recorded, ["QTWO02"]);
        assert.deepEqual(settled, [9]);
        assert.equal(queue.size(), 0);
    }

    // Q2b. A still-failing retry backs off further.
    {
        let clock = 0;
        let attempts = 0;
        const queue = createSettlementQueue({
            now: () => clock,
            record: async () => { attempts += 1; throw new Error("still down"); },
            settle: async () => undefined,
            onError: () => undefined,
        });
        await queue.enqueue(snapshotFor("QBACK1"));
        clock += 15_000;
        await queue.flushDue();
        assert.equal(attempts, 2);
        clock += 15_000;
        await queue.flushDue();
        assert.equal(attempts, 2, "second retry waits 30s");
        clock += 15_000;
        await queue.flushDue();
        assert.equal(attempts, 3);
        assert.equal(queue.size(), 1);
    }

    // Q3. Settle failure after a successful record is not buffered (the row is durable).
    {
        const errors: string[] = [];
        const queue = createSettlementQueue({
            record: async () => ({ id: 3 }),
            settle: async () => { throw new Error("settle failed"); },
            onError: (event) => errors.push(event),
        });
        await queue.enqueue(snapshotFor("QTHR03"));
        assert.equal(queue.size(), 0);
        assert.deepEqual(errors, ["match_settlement.settle.failed"]);
    }

    // Q4/Q6. The same match is buffered once and leaves the buffer once recorded.
    {
        let fail = true;
        const queue = createSettlementQueue({
            record: async () => { if (fail) throw new Error("down"); return { id: 1 }; },
            settle: async () => undefined,
            onError: () => undefined,
        });
        await queue.enqueue(snapshotFor("QFOR04"));
        await queue.enqueue(snapshotFor("QFOR04"));
        assert.equal(queue.size(), 1);
        fail = false;
        await queue.enqueue(snapshotFor("QFOR04"));
        assert.equal(queue.size(), 0, "a later successful record clears the buffered copy");
    }

    // Q5. Capacity overflow drops the oldest entry and reports it.
    {
        const dropped: string[] = [];
        const queue = createSettlementQueue({
            capacity: 2,
            record: async () => { throw new Error("down"); },
            settle: async () => undefined,
            onError: () => undefined,
            onDrop: (key) => dropped.push(key),
        });
        await queue.enqueue(snapshotFor("QCAP01"));
        await queue.enqueue(snapshotFor("QCAP02"));
        await queue.enqueue(snapshotFor("QCAP03"));
        assert.equal(queue.size(), 2);
        assert.deepEqual(dropped, ["QCAP01|2026-10-12T10:00:00.000Z"]);
    }

    // Q7. Forced flush (shutdown) ignores backoff.
    {
        let fail = true;
        const recorded: string[] = [];
        const queue = createSettlementQueue({
            now: () => 0,
            record: async (value) => { if (fail) throw new Error("down"); recorded.push(value.roomCode); return { id: 2 }; },
            settle: async () => undefined,
            onError: () => undefined,
        });
        await queue.enqueue(snapshotFor("QFRC07"));
        fail = false;
        assert.equal(await queue.flushDue(), 0);
        assert.equal(await queue.flushDue({ force: true }), 1);
        assert.deepEqual(recorded, ["QFRC07"]);
    }

    // Q8. Forced flush waits for an in-flight record before returning (graceful shutdown).
    {
        let finishRecord: () => void = () => undefined;
        const events: string[] = [];
        const queue = createSettlementQueue({
            record: async () => {
                await new Promise<void>((resolve) => { finishRecord = resolve; });
                events.push("recorded");
                return { id: 5 };
            },
            settle: async () => { events.push("settled"); },
        });
        const pending = queue.enqueue(snapshotFor("QWAIT8"));
        const flushing = queue.flushDue({ force: true }).then(() => events.push("flushed"));
        await new Promise((resolve) => setTimeout(resolve, 10));
        assert.deepEqual(events, [], "flush must not return before the record finishes");
        finishRecord();
        await Promise.all([pending, flushing]);
        assert.deepEqual(events, ["recorded", "settled", "flushed"]);
    }

    // W1. Overlapping runs share one tick.
    {
        let ticks = 0;
        let release: () => void = () => undefined;
        const worker = createSettlementWorker({
            flush: async () => 0,
            sweep: async () => {
                ticks += 1;
                await new Promise<void>((resolve) => { release = resolve; });
            },
            purge: async () => 0,
            onError: () => undefined,
        });
        const first = worker.runOnce();
        const second = worker.runOnce();
        await new Promise((resolve) => setTimeout(resolve, 10));
        release();
        await Promise.all([first, second]);
        assert.equal(ticks, 1);
    }

    // W2. Purge runs on the first tick and then hourly.
    {
        let clock = 0;
        let purges = 0;
        const worker = createSettlementWorker({
            now: () => clock,
            purgeIntervalMs: 3_600_000,
            flush: async () => 0,
            sweep: async () => undefined,
            purge: async () => { purges += 1; return 0; },
            onError: () => undefined,
        });
        await worker.runOnce();
        clock += 60_000;
        await worker.runOnce();
        assert.equal(purges, 1);
        clock += 3_600_000;
        await worker.runOnce();
        assert.equal(purges, 2);
    }

    // W3. A failing step is reported and the next tick still runs.
    {
        const errors: string[] = [];
        let sweeps = 0;
        const worker = createSettlementWorker({
            flush: async () => 0,
            sweep: async () => { sweeps += 1; if (sweeps === 1) throw new Error("sweep down"); },
            purge: async () => 0,
            onError: (event) => errors.push(event),
        });
        await worker.runOnce();
        await worker.runOnce();
        assert.equal(sweeps, 2);
        assert.deepEqual(errors, ["match_settlement.worker.tick_failed"]);
    }

    // W4. start() runs on boot and on the interval; stop() waits, force-flushes and halts.
    {
        let sweeps = 0;
        const flushes: boolean[] = [];
        const worker = createSettlementWorker({
            intervalMs: 20,
            flush: async (options) => { flushes.push(options?.force === true); return 0; },
            sweep: async () => { sweeps += 1; },
            purge: async () => 0,
            onError: () => undefined,
        });
        worker.start();
        worker.start();
        await new Promise((resolve) => setTimeout(resolve, 75));
        await worker.stop();
        const afterStop = sweeps;
        assert.ok(afterStop >= 2, "boot tick plus at least one interval tick");
        assert.equal(flushes.at(-1), true, "stop force-flushes the buffer");
        await new Promise((resolve) => setTimeout(resolve, 60));
        assert.equal(sweeps, afterStop, "no ticks after stop");
    }
}

// Runtime wiring contracts.
{
    const socketSource = readFileSync("apps/web/src/lib/socket/game-socket.ts", "utf8");
    const finishGame = socketSource.slice(
        socketSource.indexOf("function finishGame("),
        socketSource.indexOf("function resetGame(")
    );
    const goldenBranch = finishGame.indexOf('finishDecision.kind === "golden-score"');
    const goldenReturn = finishGame.indexOf("return;", goldenBranch);
    const endedAt = finishGame.indexOf("room.oyunDurumu.bittiAt = Date.now();");
    const reason = finishGame.indexOf('room.matchEndReason = "completed";');
    const enqueue = finishGame.indexOf('enqueueMatchSettlement(settlementRoom, "completed")');
    assert.ok(goldenBranch > 0 && goldenReturn > goldenBranch, "golden score branch returns early");
    assert.ok(endedAt > goldenReturn, "golden score continuation must not settle");
    assert.ok(reason > endedAt && enqueue > reason, "settle only after the match end is stamped");
    assert.equal(finishGame.split("enqueueMatchSettlement(").length, 2, "settle exactly once per finish");
    assert.match(finishGame, /const settlementRoom = getRoomMatchSnapshot\(room\.odaKodu\);/);
    const resetGame = socketSource.slice(
        socketSource.indexOf("function resetGame("),
        socketSource.indexOf("function resetGame(") + 1500
    );
    assert.match(resetGame, /room\.matchEndReason = null;/);
    assert.match(socketSource, /matchEndReason: room\.matchEndReason \?\? null,/);
    assert.match(socketSource, /matchEndReason: null,/);

    const runtimeSource = readFileSync("apps/web/server-runtime.ts", "utf8");
    const startIndex = runtimeSource.indexOf("const matchSettlementWorker = startMatchSettlementWorker();");
    assert.ok(startIndex > runtimeSource.indexOf("app.prepare().then("), "worker starts after Next is ready");
    const shutdown = runtimeSource.slice(runtimeSource.indexOf("const shutdown = async () => {"));
    const stopIndex = shutdown.indexOf("await matchSettlementWorker.stop();");
    assert.ok(stopIndex > shutdown.indexOf("io.close("), "stop settling after sockets close");
    assert.ok(stopIndex < shutdown.indexOf("await closeRedisClient();"), "drain before Redis closes");
    assert.match(runtimeSource, /matchSettlements: \{/);
    assert.match(runtimeSource, /buffered: getMatchSettlementBufferSize\(\)/);
}

void queueAndWorkerChecks()
    .then(() => console.log("match settlement unit checks passed"))
    .catch((error) => {
        console.error(error);
        process.exitCode = 1;
    });
