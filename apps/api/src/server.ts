import { createServer } from "node:http";
import {
    configureObservabilityFromEnvironment,
    emitObservabilityEvent,
    flushObservabilityExporter,
    reportError,
} from "@hushle/platform-observability";
import { getMobileApiRuntimeConfig } from "./config";
import { createMobileApiHttpHandler } from "./http-app";

configureObservabilityFromEnvironment();
const config = getMobileApiRuntimeConfig();
const server = createServer(
    createMobileApiHttpHandler({
        allowedOrigins: config.allowedOrigins,
        authEnabled: config.authEnabled,
        trustProxy: config.trustProxy,
        accessTokenTtlMs: config.accessTokenTtlMs,
        refreshTokenTtlMs: config.refreshTokenTtlMs,
    })
);

server.listen(config.port, config.host, () => {
    void emitObservabilityEvent({
        level: "info",
        service: "hushle-api",
        event: "runtime.started",
        context: { host: config.host, port: config.port },
    });
});

function shutdown(signal: string): void {
    void emitObservabilityEvent({
        level: "info",
        service: "hushle-api",
        event: "runtime.shutdown.requested",
        context: { signal },
    });
    server.close(async (error) => {
        if (error) {
            void reportError({
                service: "hushle-api",
                event: "runtime.shutdown.failed",
                error,
            });
            process.exitCode = 1;
        }
        await flushObservabilityExporter();
    });
}

process.once("SIGINT", () => shutdown("SIGINT"));
process.once("SIGTERM", () => shutdown("SIGTERM"));
