export function resolveSafeCallbackUrl(
    rawValue: string | null | undefined,
    fallbackPath: string,
    currentOrigin?: string
): string {
    const fallback = fallbackPath.startsWith("/") ? fallbackPath : `/${fallbackPath}`;

    if (!rawValue) {
        return fallback;
    }

    try {
        const resolvedOrigin =
            currentOrigin ??
            (typeof window !== "undefined"
                ? window.location.origin
                : "http://localhost");
        const candidate = new URL(rawValue, resolvedOrigin);

        if (candidate.origin !== resolvedOrigin) {
            return fallback;
        }

        if (!candidate.pathname.startsWith("/") || candidate.pathname.startsWith("//")) {
            return fallback;
        }

        return `${candidate.pathname}${candidate.search}${candidate.hash}`;
    } catch {
        return fallback;
    }
}
