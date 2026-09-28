import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { createServer } from "node:net";

async function reservePort(): Promise<number> {
    return await new Promise((resolve, reject) => {
        const server = createServer();
        server.once("error", reject);
        server.listen(0, "127.0.0.1", () => {
            const address = server.address();
            if (!address || typeof address === "string") {
                server.close();
                reject(new Error("Could not reserve an integration test port."));
                return;
            }
            server.close((error) =>
                error ? reject(error) : resolve(address.port)
            );
        });
    });
}

async function waitForServer(baseUrl: string, getLogs: () => string): Promise<void> {
    const deadline = Date.now() + 30_000;
    while (Date.now() < deadline) {
        try {
            const response = await fetch(`${baseUrl}/api/security/captcha-config?action=login`);
            if (response.ok) return;
        } catch {
            // The child process is still starting.
        }
        await new Promise((resolve) => setTimeout(resolve, 250));
    }
    throw new Error(`Production server did not become ready.\n${getLogs()}`);
}

async function main(): Promise<void> {
    const port = await reservePort();
    const baseUrl = `http://127.0.0.1:${port}`;
    let logs = "";
    const child = spawn(
        process.execPath,
        ["node_modules/tsx/dist/cli.mjs", "apps/web/server.ts"],
        {
            cwd: process.cwd(),
            env: {
                ...process.env,
                NODE_ENV: "production",
                HOST: "127.0.0.1",
                PORT: String(port),
                NEXTAUTH_URL: baseUrl,
                NEXT_PUBLIC_SITE_URL: baseUrl,
                TRUSTED_WEB_ORIGINS: baseUrl,
                STATE_CHANGE_ORIGIN_POLICY: "compatible",
            },
            stdio: ["ignore", "pipe", "pipe"],
        }
    );

    for (const stream of [child.stdout, child.stderr]) {
        stream.on("data", (chunk: Buffer) => {
            logs = `${logs}${chunk.toString("utf8")}`.slice(-8_000);
        });
    }

    try {
        await waitForServer(baseUrl, () => logs);
        const request = (headers?: Record<string, string>) =>
            fetch(`${baseUrl}/api/auth/register`, {
                method: "POST",
                headers: { "content-type": "application/json", ...headers },
                body: "{}",
            });

        const missingOrigin = await request();
        assert.equal(missingOrigin.status, 403);
        assert.equal(
            /^[A-Za-z0-9._:-]{1,64}$/.test(
                missingOrigin.headers.get("x-request-id") ?? ""
            ),
            true
        );

        const allowlistedOrigin = await request({
            origin: baseUrl,
            "sec-fetch-site": "same-origin",
            "x-request-id": "origin-integration-1",
        });
        assert.notEqual(allowlistedOrigin.status, 403);
        assert.equal(
            allowlistedOrigin.headers.get("x-request-id"),
            "origin-integration-1"
        );

        const crossSite = await request({
            origin: baseUrl,
            "sec-fetch-site": "cross-site",
        });
        assert.equal(crossSite.status, 403);

        const spoofedForwardedHost = await request({
            origin: "https://attacker.example.test",
            "x-forwarded-host": "attacker.example.test",
            "x-forwarded-proto": "https",
        });
        assert.equal(spoofedForwardedHost.status, 403);
    } finally {
        if (child.exitCode === null) {
            child.kill("SIGTERM");
            await Promise.race([
                new Promise((resolve) => child.once("exit", resolve)),
                new Promise((resolve) => setTimeout(resolve, 5_000)),
            ]);
            if (child.exitCode === null) child.kill("SIGKILL");
        }
    }

    console.log("state-change origin production integration test passed");
}

main().catch((error) => {
    console.error(error);
    process.exitCode = 1;
});
