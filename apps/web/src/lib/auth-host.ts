function isTruthyEnv(value: string | undefined): boolean {
    if (!value) {
        return false;
    }

    const normalized = value.trim().toLowerCase();
    return normalized === "1" || normalized === "true" || normalized === "yes" || normalized === "on";
}

export function shouldTrustAuthHost(): boolean {
    if (isTruthyEnv(process.env.AUTH_TRUST_HOST)) {
        return true;
    }

    return process.env.NODE_ENV !== "production";
}
