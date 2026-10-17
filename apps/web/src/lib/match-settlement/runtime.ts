import { reportError } from "@hushle/platform-observability";
import type { RoomMatchSnapshot } from "@/lib/socket/game-socket";
import { createSettlementQueue, type SettlementQueue } from "./queue";
import {
    purgeSettledMatchSettlements,
    recordMatchSettlement,
    settleMatchSettlement,
    sweepDueMatchSettlements,
} from "./service";
import { createSettlementSnapshot } from "./snapshot";
import type { MatchEndReason } from "./types";
import { createSettlementWorker, type SettlementWorker } from "./worker";

function report(event: string, error: unknown, context?: Record<string, string>): void {
    void reportError({ service: "hushle-web", event, error, context }).catch(() => undefined);
}

// One queue per process even when the module is evaluated by several bundles.
const globalForSettlement = globalThis as typeof globalThis & {
    __hushleMatchSettlementQueue?: SettlementQueue;
};

const queue =
    globalForSettlement.__hushleMatchSettlementQueue ??
    createSettlementQueue({
        record: recordMatchSettlement,
        settle: (id) => settleMatchSettlement(id),
        onDrop: (key) => report("match_settlement.buffer.dropped", new Error("Settlement buffer full"), { key }),
        onError: (event, error, context) => report(event, error, context),
    });
globalForSettlement.__hushleMatchSettlementQueue = queue;

/** Fire-and-forget: never throws and never blocks the game loop. */
export function enqueueMatchSettlement(room: RoomMatchSnapshot, endReason: MatchEndReason): void {
    let snapshot;
    try {
        snapshot = createSettlementSnapshot(room, endReason);
    } catch (error) {
        report("match_settlement.snapshot.failed", error, { roomCode: room.odaKodu });
        return;
    }
    void queue.enqueue(snapshot).catch((error) => report("match_settlement.enqueue.failed", error));
}

export function getMatchSettlementBufferSize(): number {
    return queue.size();
}

export function startMatchSettlementWorker(): SettlementWorker {
    const worker = createSettlementWorker({
        flush: (options) => queue.flushDue(options),
        sweep: () => sweepDueMatchSettlements(),
        purge: () => purgeSettledMatchSettlements(),
        onError: (event, error) => report(event, error),
    });
    worker.start();
    return worker;
}
