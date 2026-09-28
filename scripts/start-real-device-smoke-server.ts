import { pathToFileURL } from "node:url";

export interface RealDeviceSmokeConfig {
    baseUrl: string;
    port: string;
}

function isPrivateIpv4(address: string): boolean {
    const parts = address.split(".").map(Number);
    if (
        parts.length !== 4 ||
        parts.some(
            (part) => !Number.isInteger(part) || part < 0 || part > 255
        )
    ) {
        return false;
    }

    return (
        parts[0] === 10 ||
        (parts[0] === 172 && parts[1] >= 16 && parts[1] <= 31) ||
        (parts[0] === 192 && parts[1] === 168)
    );
}

export function resolveRealDeviceSmokeConfig(
    value = process.env.REAL_DEVICE_BASE_URL
): RealDeviceSmokeConfig {
    const rawBaseUrl = value?.trim();

    if (!rawBaseUrl) {
        throw new Error(
            "REAL_DEVICE_BASE_URL is required (example: http://192.168.1.20:3202)"
        );
    }

    const baseUrl = new URL(rawBaseUrl);
    const blockedHosts = new Set([
        "localhost",
        "127.0.0.1",
        "0.0.0.0",
        "[::1]",
    ]);

    if (baseUrl.protocol !== "http:") {
        throw new Error(
            "REAL_DEVICE_BASE_URL must use http for the local smoke server"
        );
    }

    if (
        blockedHosts.has(baseUrl.hostname) ||
        !isPrivateIpv4(baseUrl.hostname) ||
        baseUrl.username ||
        baseUrl.password ||
        baseUrl.pathname !== "/" ||
        baseUrl.search ||
        baseUrl.hash
    ) {
        throw new Error(
            "REAL_DEVICE_BASE_URL must be a private LAN IPv4 origin without path or credentials"
        );
    }

    const port = Number(baseUrl.port);
    if (!Number.isInteger(port) || port < 1024 || port > 65535) {
        throw new Error(
            "REAL_DEVICE_BASE_URL must include an unprivileged port between 1024 and 65535"
        );
    }

    return {
        baseUrl: baseUrl.origin,
        port: String(port),
    };
}

async function main(): Promise<void> {
    const config = resolveRealDeviceSmokeConfig();

    Object.assign(process.env, {
        NODE_ENV: "production",
        PORT: config.port,
        HOST: "0.0.0.0",
        NEXTAUTH_URL: config.baseUrl,
        NEXT_PUBLIC_SITE_URL: config.baseUrl,
        AUTH_TRUST_HOST: "true",
    });

    console.log(`Real-device smoke server: ${config.baseUrl}`);
    console.log("Stop the server after the private-network smoke session.");

    await import("../apps/web/server");
}

const entryPath = process.argv[1];
if (entryPath && import.meta.url === pathToFileURL(entryPath).href) {
    main().catch((error) => {
        console.error(error);
        process.exit(1);
    });
}
