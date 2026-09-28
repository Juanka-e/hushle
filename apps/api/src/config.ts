export interface MobileApiRuntimeConfig {
    host: string;
    port: number;
    allowedOrigins: ReadonlySet<string>;
    authEnabled: boolean;
    trustProxy: boolean;
    accessTokenTtlMs: number;
    refreshTokenTtlMs: number;
}

function parseBoolean(value: string | undefined, fallback: boolean): boolean {
    if (value === undefined || value.trim() === "") return fallback;
    if (value === "true") return true;
    if (value === "false") return false;
    throw new Error("Boolean environment values must be true or false.");
}

function parseDuration(
    value: string | undefined,
    fallback: number,
    min: number,
    max: number,
    name: string
): number {
    const result = Number(value ?? fallback);
    if (!Number.isInteger(result) || result < min || result > max) {
        throw new Error(`${name} is outside its allowed range.`);
    }
    return result;
}

function parsePort(value: string | undefined): number {
    const port = Number(value ?? "3001");
    if (!Number.isInteger(port) || port < 1 || port > 65_535) {
        throw new Error("API_PORT must be an integer between 1 and 65535.");
    }
    return port;
}

export function parseApiAllowedOrigins(
    value: string | undefined,
    nodeEnv: string | undefined
): ReadonlySet<string> {
    const configured = (value ?? "")
        .split(",")
        .map((origin) => origin.trim())
        .filter(Boolean);
    if (configured.includes("*")) {
        throw new Error("API_ALLOWED_ORIGINS must use exact origins; wildcard is forbidden.");
    }

    if (configured.length > 0) {
        return new Set(configured);
    }
    if (nodeEnv !== "production") {
        return new Set([
            "http://localhost:3000",
            "http://127.0.0.1:3000",
        ]);
    }
    return new Set();
}

export function getMobileApiRuntimeConfig(
    env: NodeJS.ProcessEnv = process.env
): MobileApiRuntimeConfig {
    const production = env.NODE_ENV === "production";
    return {
        host: env.API_HOST?.trim() || "127.0.0.1",
        port: parsePort(env.API_PORT),
        allowedOrigins: parseApiAllowedOrigins(
            env.API_ALLOWED_ORIGINS,
            env.NODE_ENV
        ),
        authEnabled: parseBoolean(env.MOBILE_AUTH_ENABLED, !production),
        trustProxy: parseBoolean(env.API_TRUST_PROXY, false),
        accessTokenTtlMs: parseDuration(
            env.MOBILE_ACCESS_TOKEN_TTL_MS,
            15 * 60_000,
            60_000,
            60 * 60_000,
            "MOBILE_ACCESS_TOKEN_TTL_MS"
        ),
        refreshTokenTtlMs: parseDuration(
            env.MOBILE_REFRESH_TOKEN_TTL_MS,
            30 * 24 * 60 * 60_000,
            60 * 60_000,
            180 * 24 * 60 * 60_000,
            "MOBILE_REFRESH_TOKEN_TTL_MS"
        ),
    };
}
