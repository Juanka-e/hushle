import assert from "node:assert/strict";
import { runRequest, startRequest } from "../apps/web/src/lib/run-request";

// The helper that effects use to apply request results without setting state synchronously.
async function main(): Promise<void> {
    const events: string[] = [];
    const handlers = {
        apply: (value: string) => events.push(`apply:${value}`),
        fail: (error: unknown) => events.push(`fail:${error instanceof Error ? error.message : String(error)}`),
        settle: () => events.push("settle"),
    };
    const later = <T>(value: T, ms = 5) => new Promise<T>((resolve) => setTimeout(() => resolve(value), ms));
    const failing = (message: string) => () => later(null).then(() => Promise.reject(new Error(message)));

    // Success and failure, each followed by settle.
    await runRequest(() => later("a"), handlers);
    await runRequest(failing("boom"), handlers);
    assert.deepEqual(events.splice(0), ["apply:a", "settle", "fail:boom", "settle"]);

    // Nothing runs synchronously: the effect body never sets state.
    const cancelNow = startRequest(() => later("sync-check"), handlers);
    assert.deepEqual(events, [], "no handler runs before the request settles");
    cancelNow();
    await later(null, 20);
    assert.deepEqual(events.splice(0), [], "a cancelled request runs no handler");

    // A cancelled request is dropped while the newer one applies (dependency change).
    const cancelOld = startRequest(() => later("old", 30), handlers);
    startRequest(() => later("new", 5), handlers);
    cancelOld();
    await later(null, 50);
    assert.deepEqual(events.splice(0), ["apply:new", "settle"]);

    // Cancelling after a failure was already scheduled drops the failure too.
    const cancelFailure = startRequest(failing("late"), handlers);
    cancelFailure();
    await later(null, 20);
    assert.deepEqual(events.splice(0), []);

    // An error thrown by apply reaches fail; settle still runs once.
    await runRequest(() => later("x"), {
        apply: () => {
            throw new Error("apply broke");
        },
        fail: handlers.fail,
        settle: handlers.settle,
    });
    assert.deepEqual(events.splice(0), ["fail:apply broke", "settle"]);

    // Optional handlers can be left out.
    await runRequest(failing("ignored"), { apply: handlers.apply });
    await runRequest(() => later("only-apply"), { apply: handlers.apply });
    assert.deepEqual(events.splice(0), ["apply:only-apply"]);

    console.log("run-request helper checks passed");
}

void main().catch((error) => {
    console.error(error);
    process.exit(1);
});
