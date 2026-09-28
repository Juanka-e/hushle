const SUPPORTED_TOPOLOGY = "single-writer" as const;

export interface RealtimeTopologyEnvironment {
    REALTIME_TOPOLOGY?: string;
    REALTIME_REPLICA_COUNT?: string;
    SOCKET_IO_POLLING_ENABLED?: string;
}

export interface RealtimeTopologyConfig {
    mode: typeof SUPPORTED_TOPOLOGY;
    declaredReplicaCount: 1;
    pollingEnabled: boolean;
    transports: Array<"websocket" | "polling">;
}

export interface RealtimeTopologyStatus {
    mode: typeof SUPPORTED_TOPOLOGY;
    declaredReplicaCount: 1;
    pollingEnabled: boolean;
    stickySessionsRequired: false;
    roomStateBackend: "process-local";
    multiInstanceReady: false;
}

function parseBooleanSetting(options: {
    name: string;
    value: string | undefined;
    fallback: boolean;
}): boolean {
    if (options.value === undefined || options.value.trim() === "") {
        return options.fallback;
    }

    const normalized = options.value.trim().toLowerCase();
    if (normalized !== "true" && normalized !== "false") {
        throw new Error(`${options.name} must be true or false`);
    }
    return normalized === "true";
}

function parseReplicaCount(value: string | undefined): 1 {
    const normalized = value?.trim() || "1";
    const parsed = Number(normalized);
    if (!Number.isSafeInteger(parsed) || parsed < 1) {
        throw new Error("REALTIME_REPLICA_COUNT must be a positive integer");
    }
    if (parsed !== 1) {
        throw new Error(
            "REALTIME_REPLICA_COUNT must remain 1 while room state is process-local"
        );
    }
    return 1;
}

export function getRealtimeTopologyConfig(
    env?: RealtimeTopologyEnvironment
): RealtimeTopologyConfig {
    const runtimeEnv = env ?? {
        REALTIME_TOPOLOGY: process.env.REALTIME_TOPOLOGY,
        REALTIME_REPLICA_COUNT: process.env.REALTIME_REPLICA_COUNT,
        SOCKET_IO_POLLING_ENABLED: process.env.SOCKET_IO_POLLING_ENABLED,
    };
    const mode = runtimeEnv.REALTIME_TOPOLOGY?.trim() || SUPPORTED_TOPOLOGY;
    if (mode !== SUPPORTED_TOPOLOGY) {
        throw new Error(
            `REALTIME_TOPOLOGY=${mode} is unsupported; use ${SUPPORTED_TOPOLOGY}`
        );
    }

    const pollingEnabled = parseBooleanSetting({
        name: "SOCKET_IO_POLLING_ENABLED",
        value: runtimeEnv.SOCKET_IO_POLLING_ENABLED,
        fallback: true,
    });

    return {
        mode,
        declaredReplicaCount: parseReplicaCount(
            runtimeEnv.REALTIME_REPLICA_COUNT
        ),
        pollingEnabled,
        transports: pollingEnabled
            ? ["websocket", "polling"]
            : ["websocket"],
    };
}

export function getRealtimeTopologyStatus(
    config: RealtimeTopologyConfig
): RealtimeTopologyStatus {
    return {
        mode: config.mode,
        declaredReplicaCount: config.declaredReplicaCount,
        pollingEnabled: config.pollingEnabled,
        stickySessionsRequired: false,
        roomStateBackend: "process-local",
        multiInstanceReady: false,
    };
}
