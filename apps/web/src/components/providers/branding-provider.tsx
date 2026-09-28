"use client";

import { createContext, useContext, useEffect, useState } from "react";
import { BRANDING_UPDATED_EVENT } from "@/lib/branding/events";
import type { BrandingSettings } from "@/types/system-settings";

const BrandingContext = createContext<BrandingSettings | null>(null);

function getIconMimeType(url: string): string {
    const cleanedUrl = url.split("?")[0].toLowerCase();
    if (cleanedUrl.endsWith(".png")) {
        return "image/png";
    }
    if (cleanedUrl.endsWith(".webp")) {
        return "image/webp";
    }
    if (cleanedUrl.endsWith(".jpg") || cleanedUrl.endsWith(".jpeg")) {
        return "image/jpeg";
    }

    return "image/x-icon";
}

function applyThemeColor(themeColor: string): void {
    if (typeof document === "undefined") {
        return;
    }

    let themeColorMeta = document.querySelector<HTMLMetaElement>(
        'meta[name="theme-color"][data-branding-managed="true"]'
    );
    if (!themeColorMeta) {
        themeColorMeta = document.createElement("meta");
        themeColorMeta.setAttribute("name", "theme-color");
        themeColorMeta.setAttribute("data-branding-managed", "true");
        document.head.appendChild(themeColorMeta);
    }

    themeColorMeta.setAttribute("content", themeColor);
}

function applyFavicon(faviconUrl: string): void {
    if (typeof document === "undefined") {
        return;
    }

    const normalizedUrl = faviconUrl.trim() || "/favicon.ico";
    const cacheBustToken = Date.now().toString(36);
    const faviconHref = `${normalizedUrl}${normalizedUrl.includes("?") ? "&" : "?"}v=${cacheBustToken}`;
    const iconType = getIconMimeType(normalizedUrl);
    const existingIcons = document.querySelectorAll(
        'link[data-branding-managed="true"]'
    );
    existingIcons.forEach((icon) => icon.remove());

    const iconDefinitions = [
        { rel: "icon", type: iconType, sizes: undefined },
        { rel: "shortcut icon", type: iconType, sizes: undefined },
        ...(iconType === "image/png"
            ? [{ rel: "apple-touch-icon", type: "image/png", sizes: "180x180" }]
            : []),
    ] as const;

    for (const definition of iconDefinitions) {
        const link = document.createElement("link");
        link.rel = definition.rel;
        link.type = definition.type;
        link.href = faviconHref;
        if (definition.sizes) {
            link.sizes = definition.sizes;
        }
        link.setAttribute("data-branding-managed", "true");
        document.head.appendChild(link);
    }
}

export function BrandingProvider({
    branding,
    children,
}: {
    branding: BrandingSettings;
    children: React.ReactNode;
}) {
    const [currentBranding, setCurrentBranding] = useState(branding);

    useEffect(() => {
        setCurrentBranding(branding);
    }, [branding]);

    useEffect(() => {
        const handleBrandingUpdated = (event: Event) => {
            const nextBranding = (event as CustomEvent<BrandingSettings>).detail;
            if (nextBranding) {
                setCurrentBranding(nextBranding);
            }
        };

        window.addEventListener(BRANDING_UPDATED_EVENT, handleBrandingUpdated);
        return () => {
            window.removeEventListener(BRANDING_UPDATED_EVENT, handleBrandingUpdated);
        };
    }, []);

    useEffect(() => {
        applyThemeColor(currentBranding.themeColor);
    }, [currentBranding.themeColor]);

    useEffect(() => {
        applyFavicon(currentBranding.faviconUrl);
    }, [currentBranding.faviconUrl]);

    return (
        <BrandingContext.Provider value={currentBranding}>
            {children}
        </BrandingContext.Provider>
    );
}

export function useBranding() {
    const context = useContext(BrandingContext);
    if (!context) {
        throw new Error("useBranding must be used within a BrandingProvider");
    }

    return context;
}
