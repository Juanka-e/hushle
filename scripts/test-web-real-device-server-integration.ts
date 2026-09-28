import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { createServer } from "node:net";
import { networkInterfaces } from "node:os";
import { resolve } from "node:path";

function isPrivateIpv4(address: string): boolean {
    const parts = address.split(".").map(Number);
    if (parts.length !== 4 || parts.some((part) => !Number.isInteger(part))) {
        return false;
    }

    return (
        parts[0] === 10 ||
        (parts[0] === 172 && parts[1] >= 16 && parts[1] <= 31) ||
        (parts[0] === 192 && parts[1] === 168)
    );
}

function findPrivateIpv4(): string {
    for (const addresses of Object.values(networkInterfaces())) {
        for (const address of addresses ?? []) {
            if (
                address.family === "IPv4" &&
                !address.internal &&
                isPrivateIpv4(address.address)
            ) {
                return address.address;
            }
        }
    }

    throw new Error("No private LAN IPv4 address is available for smoke testing");
}

async function reservePort(): Promise<number> {
    const server = createServer();
    await new Promise<void>((resolveListen, reject) => {
        server.once("error", reject);
        server.listen(0, "0.0.0.0", resolveListen);
    });
    const address = server.address();
    assert(address && typeof address !== "string");
    await new Promise<void>((resolveClose, reject) => {
        server.close((error) => (error ? reject(error) : resolveClose()));
    });
    return address.port;
}

async function waitForHttp(baseUrl: string): Promise<Response> {
    let lastError: unknown;

    for (let attempt = 0; attempt < 40; attempt += 1) {
        await new Promise((resolveWait) => setTimeout(resolveWait, 500));
        try {
            return await fetch(baseUrl);
        } catch (error) {
            lastError = error;
        }
    }

    throw lastError ?? new Error("Smoke server did not become ready");
}

async function main(): Promise<void> {
    const address = findPrivateIpv4();
    const port = await reservePort();
    const baseUrl = `http://${address}:${port}`;
    const tsxCli = resolve("node_modules", "tsx", "dist", "cli.mjs");
    const child = spawn(
        process.execPath,
        [tsxCli, "scripts/start-real-device-smoke-server.ts"],
        {
            cwd: process.cwd(),
            env: {
                ...process.env,
                REAL_DEVICE_BASE_URL: baseUrl,
            },
            stdio: ["ignore", "pipe", "pipe"],
        }
    );

    let output = "";
    const appendOutput = (chunk: Buffer): void => {
        output = `${output}${chunk.toString("utf8")}`.slice(-8_000);
    };
    child.stdout.on("data", appendOutput);
    child.stderr.on("data", appendOutput);

    try {
        const response = await Promise.race([
            waitForHttp(baseUrl),
            new Promise<never>((_, reject) => {
                child.once("exit", (code) => {
                    reject(
                        new Error(
                            `Smoke server exited before readiness (${code}).\n${output}`
                        )
                    );
                });
            }),
        ]);

        assert.equal(response.status, 200);
        assert.match(output, new RegExp(`Real-device smoke server: ${baseUrl}`));
        console.log(`Real-device LAN server integration passed at ${baseUrl}.`);
    } finally {
        if (child.exitCode === null) {
            child.kill();
            await new Promise<void>((resolveExit) => {
                child.once("exit", () => resolveExit());
                setTimeout(resolveExit, 5_000);
            });
        }
    }
}

main().catch((error) => {
    console.error(error);
    process.exit(1);
});
