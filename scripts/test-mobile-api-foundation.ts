import assert from "node:assert/strict";
import { readFileSync, readdirSync } from "node:fs";
import { createServer } from "node:http";
import type { AddressInfo } from "node:net";
import { resolve } from "node:path";
import {
    MOBILE_API_ROUTES,
    type MobileApiError,
    type MobileApiRuntimeMetaData,
    type MobileApiSuccess,
} from "@hushle/api-contracts";
import {
    getMobileApiRuntimeConfig,
    parseApiAllowedOrigins,
} from "../apps/api/src/config";
import { createMobileApiHttpHandler } from "../apps/api/src/http-app";

const allowedOrigin = "https://app.example.com";
const handler = createMobileApiHttpHandler({
    allowedOrigins: new Set([allowedOrigin]),
});
const server = createServer(handler);

async function listen(): Promise<string> {
    await new Promise<void>((resolveListen, reject) => {
        server.once("error", reject);
        server.listen(0, "127.0.0.1", resolveListen);
    });
    const address = server.address() as AddressInfo;
    return `http://127.0.0.1:${address.port}`;
}

async function close(): Promise<void> {
    await new Promise<void>((resolveClose, reject) => {
        server.close((error) => (error ? reject(error) : resolveClose()));
    });
}

function collectFiles(path: string): string[] {
    return readdirSync(path, { withFileTypes: true }).flatMap((entry) => {
        const child = resolve(path, entry.name);
        return entry.isDirectory() ? collectFiles(child) : [child];
    });
}

async function run(): Promise<void> {
    const baseUrl = await listen();
    try {
        const health = await fetch(`${baseUrl}${MOBILE_API_ROUTES.health}`, {
            headers: { "x-request-id": "mobile-smoke-1" },
        });
        assert.equal(health.status, 200);
        assert.equal(health.headers.get("cache-control"), "no-store");
        assert.equal(health.headers.get("x-request-id"), "mobile-smoke-1");
        assert.equal(health.headers.get("x-api-version"), "v1");
        assert.equal(health.headers.get("x-content-type-options"), "nosniff");
        assert.equal(health.headers.get("access-control-allow-origin"), null);

        const meta = await fetch(`${baseUrl}${MOBILE_API_ROUTES.meta}`, {
            headers: { origin: allowedOrigin },
        });
        assert.equal(meta.status, 200);
        assert.equal(
            meta.headers.get("access-control-allow-origin"),
            allowedOrigin
        );
        const metaPayload =
            (await meta.json()) as MobileApiSuccess<MobileApiRuntimeMetaData>;
        assert.equal(metaPayload.ok, true);
        assert.equal(metaPayload.data.capabilities.runtimeMeta, "available");
        assert.equal(metaPayload.data.capabilities.bearerAuth, "planned");
        assert.equal(metaPayload.data.capabilities.inventory, "planned");
        assert.equal(metaPayload.data.capabilities.storeCatalog, "planned");
        assert.equal(
            metaPayload.data.capabilities.realtimeGameplay,
            "web_runtime_only"
        );

        const denied = await fetch(`${baseUrl}${MOBILE_API_ROUTES.meta}`, {
            headers: { origin: "https://evil.example.com" },
        });
        assert.equal(denied.status, 403);
        assert.equal(denied.headers.get("access-control-allow-origin"), null);
        const deniedPayload = (await denied.json()) as MobileApiError;
        assert.equal(deniedPayload.error.code, "cors_denied");

        const preflight = await fetch(`${baseUrl}${MOBILE_API_ROUTES.meta}`, {
            method: "OPTIONS",
            headers: { origin: allowedOrigin },
        });
        assert.equal(preflight.status, 204);
        assert.equal(
            preflight.headers.get("access-control-allow-methods"),
            "GET, POST, PATCH, DELETE, OPTIONS"
        );

        const wrongMethod = await fetch(`${baseUrl}${MOBILE_API_ROUTES.meta}`, {
            method: "POST",
        });
        assert.equal(wrongMethod.status, 405);
        assert.equal(wrongMethod.headers.get("allow"), "GET, OPTIONS");

        const missing = await fetch(`${baseUrl}/v1/not-found`);
        assert.equal(missing.status, 404);
        const missingPayload = (await missing.json()) as MobileApiError;
        assert.equal(missingPayload.error.code, "not_found");

        const invalidRequestId = await fetch(
            `${baseUrl}${MOBILE_API_ROUTES.health}`,
            { headers: { "x-request-id": "spaces are not accepted" } }
        );
        assert.match(
            invalidRequestId.headers.get("x-request-id") ?? "",
            /^[0-9a-f-]{36}$/
        );
    } finally {
        await close();
    }

    assert.deepEqual(
        [...parseApiAllowedOrigins(undefined, "production")],
        []
    );
    assert.ok(
        parseApiAllowedOrigins(undefined, "development").has(
            "http://localhost:3000"
        )
    );
    assert.throws(
        () => parseApiAllowedOrigins("*", "production"),
        /wildcard is forbidden/
    );
    assert.throws(
        () =>
            getMobileApiRuntimeConfig({
                ...process.env,
                API_PORT: "70000",
            }),
        /API_PORT/
    );
    assert.equal(
        getMobileApiRuntimeConfig({
            ...process.env,
            NODE_ENV: "production",
            MOBILE_AUTH_ENABLED: undefined,
        }).authEnabled,
        false
    );

    const disabledAuth = await (async () => {
        const disabledServer = createServer(
            createMobileApiHttpHandler({
                allowedOrigins: new Set(),
                authEnabled: false,
            })
        );
        await new Promise<void>((resolveListen) =>
            disabledServer.listen(0, "127.0.0.1", resolveListen)
        );
        const address = disabledServer.address() as AddressInfo;
        try {
            return await fetch(
                `http://127.0.0.1:${address.port}${MOBILE_API_ROUTES.authLogin}`,
                {
                    method: "POST",
                    headers: { "content-type": "application/json" },
                    body: JSON.stringify({
                        username: "test",
                        password: "test",
                        deviceName: "test",
                    }),
                }
            );
        } finally {
            await new Promise<void>((resolveClose) =>
                disabledServer.close(() => resolveClose())
            );
        }
    })();
    assert.equal(disabledAuth.status, 503);
    const disabledPayload = (await disabledAuth.json()) as MobileApiError;
    assert.equal(disabledPayload.error.code, "auth_unavailable");

    const disabledPlayerServer = createServer(
        createMobileApiHttpHandler({
            allowedOrigins: new Set(),
            authEnabled: false,
        })
    );
    await new Promise<void>((resolveListen) =>
        disabledPlayerServer.listen(0, "127.0.0.1", resolveListen)
    );
    const disabledPlayerAddress =
        disabledPlayerServer.address() as AddressInfo;
    const disabledPlayerResponses = await Promise.all(
        [
            MOBILE_API_ROUTES.me,
            MOBILE_API_ROUTES.inventory,
            MOBILE_API_ROUTES.inventoryEquipped,
            MOBILE_API_ROUTES.storeCatalog,
        ].map((route) =>
            fetch(`http://127.0.0.1:${disabledPlayerAddress.port}${route}`)
        )
    );
    await new Promise<void>((resolveClose) =>
        disabledPlayerServer.close(() => resolveClose())
    );
    for (const response of disabledPlayerResponses) {
        assert.equal(response.status, 503);
        assert.equal(
            ((await response.json()) as MobileApiError).error.code,
            "auth_unavailable"
        );
    }

    const apiSourceRoot = resolve(process.cwd(), "apps/api/src");
    for (const file of collectFiles(apiSourceRoot).filter((path) =>
        path.endsWith(".ts")
    )) {
        const source = readFileSync(file, "utf8");
        assert.doesNotMatch(source, /from\s+["']next(?:\/|["'])/);
        assert.doesNotMatch(source, /apps\/web|@\/lib|@\/app/);
    }

    const compose = readFileSync(resolve(process.cwd(), "docker-compose.yml"), "utf8");
    assert.match(compose, /api:\s*\n\s+profiles: \["api"\]/);
    assert.match(compose, /API_ALLOWED_ORIGINS/);

    console.log("test:mobile-api-foundation ok");
}

void run();
