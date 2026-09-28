import assert from "node:assert/strict";
import {
    getRealtimeTopologyConfig,
    getRealtimeTopologyStatus,
} from "../apps/web/src/lib/socket/realtime-topology";

function assertConfigError(
    env: Parameters<typeof getRealtimeTopologyConfig>[0],
    expectedMessage: RegExp
): void {
    assert.throws(() => getRealtimeTopologyConfig(env), expectedMessage);
}

function run(): void {
    const defaults = getRealtimeTopologyConfig({});
    assert.deepEqual(defaults, {
        mode: "single-writer",
        declaredReplicaCount: 1,
        pollingEnabled: true,
        transports: ["websocket", "polling"],
    });

    const websocketOnly = getRealtimeTopologyConfig({
        REALTIME_TOPOLOGY: "single-writer",
        REALTIME_REPLICA_COUNT: "1",
        SOCKET_IO_POLLING_ENABLED: "false",
    });
    assert.deepEqual(websocketOnly.transports, ["websocket"]);
    assert.equal(websocketOnly.pollingEnabled, false);

    assertConfigError(
        { REALTIME_TOPOLOGY: "multi-writer" },
        /REALTIME_TOPOLOGY=multi-writer is unsupported/
    );
    for (const replicaCount of ["0", "2", "1.5", "many"]) {
        assertConfigError(
            { REALTIME_REPLICA_COUNT: replicaCount },
            /REALTIME_REPLICA_COUNT/
        );
    }
    assertConfigError(
        { SOCKET_IO_POLLING_ENABLED: "yes" },
        /SOCKET_IO_POLLING_ENABLED must be true or false/
    );

    assert.deepEqual(getRealtimeTopologyStatus(defaults), {
        mode: "single-writer",
        declaredReplicaCount: 1,
        pollingEnabled: true,
        stickySessionsRequired: false,
        roomStateBackend: "process-local",
        multiInstanceReady: false,
    });

    console.log("Realtime deployment topology checks passed.");
}

run();
