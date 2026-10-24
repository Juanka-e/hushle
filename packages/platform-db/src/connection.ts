/**
 * Pool settings for the MariaDB driver adapter, read from DATABASE_URL.
 *
 * Prisma 7 talks to MySQL through the `mariadb` driver instead of its own engine. The URL
 * parameters Prisma 6 understood are mapped to the driver's options, and its defaults are
 * kept: a 5 s connect timeout and a 10 s wait for a free pool connection. A parameter the
 * mapping does not know (TLS settings, for example) is rejected instead of dropped, so a
 * connection never silently loses an option it was configured with.
 *
 * The driver's own pool opens `connectionLimit` connections up front and keeps them; like
 * Prisma 6, this pool opens connections as queries need them and closes idle ones.
 */
export interface DatabasePoolConfig {
    host: string;
    port: number;
    user: string;
    password: string;
    database: string;
    connectionLimit: number;
    connectTimeout: number;
    acquireTimeout: number;
    socketTimeout?: number;
    minimumIdle: 0;
    idleTimeout: number;
    /**
     * MySQL 8 authenticates with caching_sha2_password. Without TLS, its first login after a
     * server restart needs the server's RSA key, which Prisma 6's engine also fetched.
     */
    allowPublicKeyRetrieval: true;
}

export const DEFAULT_DATABASE_CONNECTION_LIMIT = 20;
const DEFAULT_CONNECT_TIMEOUT_SECONDS = 5;
const DEFAULT_POOL_TIMEOUT_SECONDS = 10;
const IDLE_CONNECTION_TIMEOUT_SECONDS = 300;
/** The DATABASE_URL query parameters the adapter accepts (the production preflight repeats this list). */
export const SUPPORTED_DATABASE_URL_PARAMETERS = ["connection_limit", "connect_timeout", "pool_timeout", "socket_timeout"] as const;
const SUPPORTED_PARAMETERS = new Set<string>(SUPPORTED_DATABASE_URL_PARAMETERS);

function readPositiveInteger(value: string | undefined, max: number): number | null {
    if (value === undefined || !/^\d+$/.test(value.trim())) return null;
    const parsed = Number(value);
    return parsed >= 1 && parsed <= max ? parsed : null;
}

function readSeconds(url: URL, name: string, fallback: number): number {
    const raw = url.searchParams.get(name);
    if (raw === null) return fallback * 1000;
    const seconds = readPositiveInteger(raw, 3600);
    if (seconds === null) {
        throw new Error(`DATABASE_URL parameter ${name} must be a whole number of seconds between 1 and 3600.`);
    }
    return seconds * 1000;
}

/**
 * `connection_limit` in the URL wins over DATABASE_CONNECTION_LIMIT (1-100), which wins over
 * the default of 20.
 */
export function resolveDatabasePoolConfig(
    databaseUrl: string,
    env: Record<string, string | undefined> = process.env
): DatabasePoolConfig {
    let url: URL;
    try {
        url = new URL(databaseUrl);
    } catch {
        throw new Error("DATABASE_URL is not a valid mysql:// URL.");
    }
    if (url.protocol !== "mysql:" && url.protocol !== "mariadb:") {
        throw new Error(`DATABASE_URL must use mysql://, not ${url.protocol}//.`);
    }
    if (!url.hostname) throw new Error("DATABASE_URL has no host.");
    const database = decodeURIComponent(url.pathname.replace(/^\//, ""));
    if (!database) throw new Error("DATABASE_URL has no database name.");

    for (const name of url.searchParams.keys()) {
        if (!SUPPORTED_PARAMETERS.has(name)) {
            throw new Error(
                `DATABASE_URL parameter ${name} is not supported with the MariaDB driver adapter; ` +
                    `supported: ${SUPPORTED_DATABASE_URL_PARAMETERS.join(", ")}.`
            );
        }
    }

    const urlLimit = url.searchParams.get("connection_limit");
    let connectionLimit = readPositiveInteger(env.DATABASE_CONNECTION_LIMIT, 100) ?? DEFAULT_DATABASE_CONNECTION_LIMIT;
    if (urlLimit !== null) {
        const parsed = readPositiveInteger(urlLimit, 1000);
        if (parsed === null) throw new Error("DATABASE_URL parameter connection_limit must be a positive whole number.");
        connectionLimit = parsed;
    }

    const config: DatabasePoolConfig = {
        // URL keeps IPv6 hosts in brackets; the driver wants the bare address.
        host: url.hostname.replace(/^\[(.*)\]$/, "$1"),
        port: url.port ? Number(url.port) : 3306,
        user: decodeURIComponent(url.username),
        password: decodeURIComponent(url.password),
        database,
        connectionLimit,
        connectTimeout: readSeconds(url, "connect_timeout", DEFAULT_CONNECT_TIMEOUT_SECONDS),
        acquireTimeout: readSeconds(url, "pool_timeout", DEFAULT_POOL_TIMEOUT_SECONDS),
        minimumIdle: 0,
        idleTimeout: IDLE_CONNECTION_TIMEOUT_SECONDS,
        allowPublicKeyRetrieval: true,
    };
    if (url.searchParams.has("socket_timeout")) {
        config.socketTimeout = readSeconds(url, "socket_timeout", 0);
    }
    return config;
}
