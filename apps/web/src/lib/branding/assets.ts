export function isAutomaticBrandingPreviewUrl(value: string): boolean {
    const trimmed = value.trim();
    if (!trimmed) {
        return false;
    }

    // Only preview same-app root-relative assets automatically.
    return trimmed.startsWith("/") && !trimmed.startsWith("//");
}
