import { isIP } from "node:net";

interface RequestLike {
    headers: Headers;
}

interface SocketLike {
    handshake: {
        headers: Record<string, string | string[] | undefined>;
        address?: string;
    };
}

function isTruthyEnv(value: string | undefined): boolean {
    if (!value) {
        return false;
    }

    const normalized = value.trim().toLowerCase();
    return normalized === "1" || normalized === "true" || normalized === "yes" || normalized === "on";
}

export function shouldTrustProxyHeaders(): boolean {
    return isTruthyEnv(process.env.TRUST_PROXY);
}

export function normalizeIp(rawIp: string | null | undefined): string {
    if (!rawIp) {
        return "unknown";
    }

    const normalized = rawIp.replace(/^::ffff:/, "").trim();
    return isIP(normalized) ? normalized : "unknown";
}

export function getTrustedForwardedIp(
    forwardedFor: string | string[] | null | undefined,
    realIp?: string | string[] | null | undefined
): string | null {
    if (!shouldTrustProxyHeaders()) {
        return null;
    }

    // The private ingress must replace these headers, not append client input.
    for (const candidate of [realIp, forwardedFor]) {
        if (typeof candidate !== "string" || candidate.includes(",")) continue;
        const normalized = normalizeIp(candidate);
        if (normalized !== "unknown") return normalized;
    }

    return null;
}

export function getRequestIp(request: RequestLike): string {
    return (
        getTrustedForwardedIp(
            request.headers.get("x-forwarded-for"),
            request.headers.get("x-real-ip")
        ) ?? "unknown"
    );
}

export function getSocketClientIp(socket: SocketLike): string {
    return (
        getTrustedForwardedIp(
            socket.handshake.headers["x-forwarded-for"],
            socket.handshake.headers["x-real-ip"]
        ) ?? normalizeIp(socket.handshake.address)
    );
}
