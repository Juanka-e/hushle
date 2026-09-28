const LOOPBACK_HOSTS = new Set(["localhost", "127.0.0.1", "[::1]"]);

interface WebOriginEnvironment {
    [key: string]: string | undefined;
    NEXT_PUBLIC_SITE_URL?: string;
    TRUSTED_WEB_ORIGINS?: string;
}

export function allowOriginlessSocketClients(
    isDev: boolean,
    value = process.env.ALLOW_ORIGINLESS_SOCKET_CLIENTS
): boolean {
    if (value === undefined || value.trim() === "") return isDev;
    const normalized = value.trim().toLowerCase();
    if (normalized === "true") return true;
    if (normalized === "false") return false;
    throw new Error("ALLOW_ORIGINLESS_SOCKET_CLIENTS must be true or false");
}

function normalizeConfiguredOrigin(value: string): string {
    if (value === "*") {
        throw new Error("Wildcard origins are not allowed");
    }

    const url = new URL(value);
    if (!["http:", "https:"].includes(url.protocol)) {
        throw new Error(`Unsupported origin protocol: ${url.protocol}`);
    }
    if (
        url.username ||
        url.password ||
        url.pathname !== "/" ||
        url.search ||
        url.hash
    ) {
        throw new Error(`Expected an origin without path or credentials: ${value}`);
    }

    return url.origin;
}

export function parseTrustedWebOrigins(
    env: WebOriginEnvironment = process.env
): ReadonlySet<string> {
    const configured = [
        env.NEXT_PUBLIC_SITE_URL,
        ...(env.TRUSTED_WEB_ORIGINS ?? "").split(","),
    ]
        .map((value) => value?.trim())
        .filter((value): value is string => Boolean(value));

    return new Set(configured.map(normalizeConfiguredOrigin));
}

export function isTrustedWebOrigin(input: {
    origin: string | undefined;
    isDev: boolean;
    trustedOrigins?: ReadonlySet<string>;
    allowMissingOrigin?: boolean;
}): boolean {
    if (!input.origin) {
        return input.allowMissingOrigin ?? false;
    }

    let url: URL;
    try {
        url = new URL(input.origin);
    } catch {
        return false;
    }

    if (!["http:", "https:"].includes(url.protocol)) {
        return false;
    }

    if (input.isDev && LOOPBACK_HOSTS.has(url.hostname)) {
        return true;
    }

    return (input.trustedOrigins ?? parseTrustedWebOrigins()).has(url.origin);
}
