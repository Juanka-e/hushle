import type { BrandingSettings } from "@/types/system-settings";

export const BRANDING_UPDATED_EVENT = "tabu:branding-updated";

export function dispatchBrandingUpdated(branding: BrandingSettings): void {
    if (typeof window === "undefined") {
        return;
    }

    window.dispatchEvent(
        new CustomEvent<BrandingSettings>(BRANDING_UPDATED_EVENT, {
            detail: branding,
        })
    );
}
