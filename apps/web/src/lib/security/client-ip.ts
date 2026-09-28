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

    return rawIp.replace(/^::ffff:/, "").trim() || "unknown";
}

export function getTrustedForwardedIp(
    forwardedFor: string | string[] | null | undefined,
    realIp?: string | string[] | null | undefined
): string | null {
    if (!shouldTrustProxyHeaders()) {
        return null;
    }

    const firstForwarded = Array.isArray(forwardedFor) ? forwardedFor[0] : forwardedFor;
    if (firstForwarded) {
        return normalizeIp(firstForwarded.split(",")[0]);
    }

    const firstRealIp = Array.isArray(realIp) ? realIp[0] : realIp;
    if (firstRealIp) {
        return normalizeIp(firstRealIp);
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
