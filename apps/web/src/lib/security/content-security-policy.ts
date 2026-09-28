interface ContentSecurityPolicyOptions {
    nonce: string;
    isDev: boolean;
    upgradeInsecureRequests?: boolean;
    externalSources?: ContentSecurityPolicyExternalSources;
}

export interface ContentSecurityPolicyExternalSources {
    styles?: readonly string[];
    fonts?: readonly string[];
    connections?: readonly string[];
}

interface ContentSecurityPolicyEnvironment {
    [key: string]: string | undefined;
    CSP_STYLE_SOURCES?: string;
    CSP_FONT_SOURCES?: string;
    CSP_CONNECT_SOURCES?: string;
}

const YOUTUBE_FRAME_SOURCES = [
    "https://www.youtube.com",
    "https://www.youtube-nocookie.com",
];
const TURNSTILE_ORIGIN = "https://challenges.cloudflare.com";
const PAYTR_FRAME_ORIGIN = "https://www.paytr.com";

export function generateCspNonce(): string {
    return Buffer.from(crypto.randomUUID()).toString("base64");
}

function parseSourceList(
    value: string | undefined,
    isDev: boolean,
    type: "asset" | "connection"
): string[] {
    if (!value) return [];

    return value
        .split(",")
        .map((source) => source.trim())
        .filter(Boolean)
        .map((source) => {
            if (source === "*") {
                throw new Error("Wildcard CSP sources are not allowed");
            }

            const url = new URL(source);
            const isLocalHttp =
                isDev &&
                ["http:", "ws:"].includes(url.protocol) &&
                ["localhost", "127.0.0.1", "[::1]"].includes(url.hostname);
            const allowedProtocols =
                type === "connection" ? ["https:", "wss:"] : ["https:"];
            if (!allowedProtocols.includes(url.protocol) && !isLocalHttp) {
                throw new Error(`Unsupported CSP source protocol: ${source}`);
            }
            if (
                url.username ||
                url.password ||
                url.pathname !== "/" ||
                url.search ||
                url.hash
            ) {
                throw new Error(`CSP source must be an origin: ${source}`);
            }

            return url.origin;
        });
}

export function getConfiguredCspSources(
    isDev: boolean,
    env: ContentSecurityPolicyEnvironment = process.env
): ContentSecurityPolicyExternalSources {
    return {
        styles: parseSourceList(env.CSP_STYLE_SOURCES, isDev, "asset"),
        fonts: parseSourceList(env.CSP_FONT_SOURCES, isDev, "asset"),
        connections: parseSourceList(
            env.CSP_CONNECT_SOURCES,
            isDev,
            "connection"
        ),
    };
}

export function shouldUpgradeInsecureRequests(
    isDev: boolean,
    publicSiteUrl = process.env.NEXT_PUBLIC_SITE_URL
): boolean {
    if (isDev) return false;
    if (!publicSiteUrl?.trim()) return true;

    try {
        return new URL(publicSiteUrl).protocol === "https:";
    } catch {
        return true;
    }
}

export function buildContentSecurityPolicy({
    nonce,
    isDev,
    upgradeInsecureRequests = !isDev,
    externalSources = getConfiguredCspSources(isDev),
}: ContentSecurityPolicyOptions): string {
    const directives: Array<[string, string[]]> = [
        ["default-src", ["'self'"]],
        [
            "script-src",
            [
                "'self'",
                `'nonce-${nonce}'`,
                "'strict-dynamic'",
                TURNSTILE_ORIGIN,
                ...(isDev ? ["'unsafe-eval'"] : []),
            ],
        ],
        ["script-src-attr", ["'none'"]],
        ["style-src", ["'self'", "'unsafe-inline'", ...(externalSources.styles ?? [])]],
        ["style-src-attr", ["'unsafe-inline'"]],
        ["img-src", ["'self'", "data:", "blob:", "https:"]],
        ["font-src", ["'self'", "data:", ...(externalSources.fonts ?? [])]],
        [
            "connect-src",
            [
                "'self'",
                "ws:",
                "wss:",
                TURNSTILE_ORIGIN,
                ...(externalSources.connections ?? []),
            ],
        ],
        ["frame-src", ["'self'", TURNSTILE_ORIGIN, PAYTR_FRAME_ORIGIN, ...YOUTUBE_FRAME_SOURCES]],
        ["media-src", ["'self'", "blob:", "https:"]],
        ["object-src", ["'none'"]],
        ["base-uri", ["'self'"]],
        ["form-action", ["'self'"]],
        ["frame-ancestors", ["'none'"]],
    ];

    if (upgradeInsecureRequests) {
        directives.push(["upgrade-insecure-requests", []]);
    }

    return directives
        .map(([directive, values]) =>
            values.length > 0 ? `${directive} ${values.join(" ")}` : directive
        )
        .join("; ");
}
