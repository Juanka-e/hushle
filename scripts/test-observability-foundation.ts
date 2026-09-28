import assert from "node:assert/strict";
import { createServer } from "node:http";
import { onRequestError } from "../apps/web/src/instrumentation";
import {
    configureObservabilityExporter,
    configureObservabilityFromEnvironment,
    emitObservabilityEvent,
    flushObservabilityExporter,
    getObservabilityStatus,
    getOrCreateRequestId,
    isValidRequestId,
    reportError,
    resetObservabilityForTests,
    type ObservabilityEvent,
} from "@hushle/platform-observability";

async function waitUntil(predicate: () => boolean, timeoutMs = 1_000): Promise<void> {
    const deadline = Date.now() + timeoutMs;
    while (!predicate()) {
        if (Date.now() >= deadline) throw new Error("Timed out waiting for condition");
        await new Promise((resolve) => setTimeout(resolve, 10));
    }
}

async function main(): Promise<void> {
    const lines: string[] = [];
    resetObservabilityForTests({
        sink: (_level, line) => lines.push(line),
    });

    assert.equal(getOrCreateRequestId("request.valid-1"), "request.valid-1");
    const generatedId = getOrCreateRequestId("spaces are rejected");
    assert.equal(isValidRequestId(generatedId), true);
    assert.notEqual(generatedId, "spaces are rejected");

    const exported: ObservabilityEvent[] = [];
    configureObservabilityExporter({
        capture(event) {
            exported.push(event);
        },
    });

    const secret = "database-password-value";
    await reportError({
        service: "hushle-web",
        event: "test.failure",
        requestId: "request.valid-1",
        error: new Error(`mysql://hushle:${secret}@mysql:3306/hushle`),
        context: {
            method: "POST",
            path: "/api/test",
            email: "player@example.test",
            note: "player@example.test Bearer abc.def.ghi token=unsafe-value",
            nested: { unsafe: true },
        },
    });

    assert.equal(lines.length, 1);
    assert.equal(exported.length, 1);
    const serialized = lines[0] ?? "";
    assert.equal(serialized.includes(secret), false);
    assert.equal(serialized.includes("player@example.test"), false);
    assert.equal(serialized.includes("abc.def.ghi"), false);
    assert.equal(serialized.includes("unsafe-value"), false);

    const parsed = JSON.parse(serialized) as ObservabilityEvent;
    assert.equal(isValidRequestId(parsed.eventId), true);
    assert.equal(parsed.level, "error");
    assert.equal(parsed.service, "hushle-web");
    assert.equal(parsed.event, "test.failure");
    assert.equal(parsed.requestId, "request.valid-1");
    assert.deepEqual(parsed.context?.method, "POST");
    assert.equal("email" in (parsed.context ?? {}), false);
    assert.equal("nested" in (parsed.context ?? {}), false);

    configureObservabilityExporter({
        capture() {
            throw new Error("provider unavailable");
        },
    });
    await emitObservabilityEvent({
        level: "warn",
        service: "hushle-api",
        event: "exporter.test",
    });

    const status = getObservabilityStatus();
    assert.equal(status.emitted, 2);
    assert.equal(status.errors, 1);
    assert.equal(status.warnings, 1);
    assert.equal(status.exporterConfigured, true);
    assert.equal(status.exporterFailures, 1);
    assert.ok(status.droppedContextFields >= 2);
    assert.ok(status.lastErrorAt);

    configureObservabilityExporter({
        async capture() {
            throw new Error("async provider unavailable");
        },
    });
    await emitObservabilityEvent({
        level: "info",
        service: "hushle-web",
        event: "exporter.async_test",
    });
    await new Promise((resolve) => setTimeout(resolve, 0));
    assert.equal(getObservabilityStatus().exporterFailures, 2);

    configureObservabilityExporter({
        capture() {},
        async flush() {
            await new Promise((resolve) => setTimeout(resolve, 20));
        },
    });
    assert.equal(await flushObservabilityExporter(100), true);
    configureObservabilityExporter({
        capture() {},
        async flush() {
            await new Promise(() => undefined);
        },
    });
    assert.equal(await flushObservabilityExporter(5), false);
    assert.equal(getObservabilityStatus().exporterFailures, 3);

    const hookLines: string[] = [];
    resetObservabilityForTests({
        sink: (_level, line) => hookLines.push(line),
    });
    await onRequestError(
        Object.assign(new Error("render failed"), { digest: "digest-1" }),
        {
            path: "/admin?private=value",
            method: "GET",
            headers: { "x-request-id": "next-hook-1" },
        },
        {
            routerKind: "App Router",
            routePath: "/admin",
            routeType: "render",
            renderSource: "server-rendering",
            revalidateReason: undefined,
        }
    );
    assert.equal(hookLines.length, 1);
    const hookEvent = JSON.parse(hookLines[0] ?? "") as ObservabilityEvent;
    assert.equal(hookEvent.event, "next.request.uncaught");
    assert.equal(hookEvent.requestId, "next-hook-1");
    assert.equal(JSON.stringify(hookEvent).includes("private=value"), false);

    const requests: Array<{ authorization: string | undefined; body: string }> = [];
    let rejectDelivery = false;
    let holdNextDelivery = false;
    const heldDelivery: { release?: () => void } = {};
    const collector = createServer((request, response) => {
        const chunks: Buffer[] = [];
        request.on("data", (chunk) => chunks.push(Buffer.from(chunk)));
        request.on("end", async () => {
            requests.push({
                authorization: request.headers.authorization,
                body: Buffer.concat(chunks).toString("utf8"),
            });
            if (holdNextDelivery) {
                holdNextDelivery = false;
                await new Promise<void>((resolve) => {
                    heldDelivery.release = resolve;
                });
            }
            response.writeHead(rejectDelivery ? 503 : 202);
            response.end();
        });
    });
    await new Promise<void>((resolve) => collector.listen(0, "127.0.0.1", resolve));
    const address = collector.address();
    assert.ok(address && typeof address === "object");
    const exporterEnv = {
        NODE_ENV: "test",
        OBSERVABILITY_EXPORT_MODE: "http",
        OBSERVABILITY_EXPORT_URL: `http://127.0.0.1:${address.port}/events`,
        OBSERVABILITY_EXPORT_TOKEN: "collector-test-token",
        OBSERVABILITY_EXPORT_BATCH_SIZE: "2",
        OBSERVABILITY_EXPORT_QUEUE_LIMIT: "20",
        OBSERVABILITY_EXPORT_FLUSH_INTERVAL_MS: "60000",
        OBSERVABILITY_EXPORT_TIMEOUT_MS: "1000",
    } as NodeJS.ProcessEnv;

    assert.throws(
        () =>
            configureObservabilityFromEnvironment({
                NODE_ENV: "test",
                OBSERVABILITY_EXPORT_MODE: "typo",
            }),
        /must be disabled or http/
    );
    assert.throws(
        () =>
            configureObservabilityFromEnvironment({
                ...exporterEnv,
                NODE_ENV: "production",
            }),
        /Invalid OBSERVABILITY_EXPORT_URL/
    );
    assert.throws(
        () =>
            configureObservabilityFromEnvironment({
                ...exporterEnv,
                NODE_ENV: "production",
                OBSERVABILITY_EXPORT_URL: "https://collector.example.test/events",
                OBSERVABILITY_EXPORT_TOKEN: "short",
            }),
        /missing or too short/
    );

    try {
        resetObservabilityForTests({ sink: () => undefined });
        configureObservabilityFromEnvironment(exporterEnv);
        await reportError({
            service: "hushle-web",
            event: "collector.first",
            error: new Error("player@example.test token=unsafe"),
        });
        await emitObservabilityEvent({
            level: "info",
            service: "hushle-api",
            event: "collector.second",
        });
        await waitUntil(() => getObservabilityStatus().exporterDelivered === 2);
        assert.equal(requests.length, 1);
        assert.equal(requests[0]?.authorization, "Bearer collector-test-token");
        assert.equal(requests[0]?.body.includes("player@example.test"), false);
        assert.equal(requests[0]?.body.includes("token=unsafe"), false);
        assert.equal(getObservabilityStatus().exporterMode, "http");
        assert.equal(getObservabilityStatus().exporterDelivered, 2);
        assert.equal(getObservabilityStatus().exporterQueued, 0);

        await emitObservabilityEvent({
            level: "warn",
            service: "hushle-jobs",
            event: "collector.pending",
        });
        assert.equal(getObservabilityStatus().exporterQueued, 1);
        configureObservabilityFromEnvironment(exporterEnv);
        assert.equal(getObservabilityStatus().exporterQueued, 1);
        assert.equal(await flushObservabilityExporter(1_000), true);
        assert.equal(getObservabilityStatus().exporterDelivered, 3);

        resetObservabilityForTests({ sink: () => undefined });
        configureObservabilityFromEnvironment({
            ...exporterEnv,
            OBSERVABILITY_EXPORT_BATCH_SIZE: "100",
        });
        for (let index = 0; index < 21; index += 1) {
            await emitObservabilityEvent({
                level: "info",
                service: "hushle-web",
                event: "collector.queue_test",
                context: { index },
            });
        }
        assert.equal(getObservabilityStatus().exporterQueued, 20);
        assert.equal(getObservabilityStatus().exporterDropped, 1);

        resetObservabilityForTests({ sink: () => undefined });
        rejectDelivery = true;
        holdNextDelivery = true;
        const retryRequestStart = requests.length;
        configureObservabilityFromEnvironment({
            ...exporterEnv,
            OBSERVABILITY_EXPORT_BATCH_SIZE: "1",
        });
        await reportError({
            service: "hushle-web",
            event: "collector.retry_test",
            error: new Error("delivery failure"),
        });
        await waitUntil(() => heldDelivery.release !== undefined);
        for (let index = 0; index < 5; index += 1) {
            await emitObservabilityEvent({
                level: "info",
                service: "hushle-web",
                event: "collector.concurrent_test",
                context: { index },
            });
        }
        heldDelivery.release?.();
        await waitUntil(() => getObservabilityStatus().exporterFailures === 1);
        assert.equal(getObservabilityStatus().exporterQueued, 6);
        rejectDelivery = false;
        assert.equal(await flushObservabilityExporter(1_000), true);
        assert.equal(getObservabilityStatus().exporterDelivered, 6);
        assert.equal(getObservabilityStatus().exporterQueued, 0);
        const failedBatch = JSON.parse(requests[retryRequestStart]?.body ?? "") as {
            events: ObservabilityEvent[];
        };
        const retriedBatch = JSON.parse(requests[retryRequestStart + 1]?.body ?? "") as {
            events: ObservabilityEvent[];
        };
        assert.equal(failedBatch.events[0]?.eventId, retriedBatch.events[0]?.eventId);
    } finally {
        resetObservabilityForTests({ sink: () => undefined });
        await new Promise<void>((resolve, reject) =>
            collector.close((error) => (error ? reject(error) : resolve()))
        );
    }

    console.log("observability foundation tests passed");
}

main().catch((error) => {
    console.error(error);
    process.exitCode = 1;
});
