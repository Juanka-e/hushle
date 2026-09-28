import type { Metadata, Viewport } from "next";
import type { BrandingSettings } from "@/types/system-settings";

export function resolveSiteUrl(): URL | undefined {
    const rawUrl =
        process.env.NEXT_PUBLIC_SITE_URL?.trim() ||
        process.env.NEXTAUTH_URL?.trim() ||
        "http://localhost:3000";

    try {
        return new URL(rawUrl);
    } catch {
        return undefined;
    }
}

export function buildCanonicalUrl(pathname: string): string | undefined {
    const metadataBase = resolveSiteUrl();
    if (!metadataBase) {
        return undefined;
    }

    return new URL(pathname, metadataBase).toString();
}

function normalizeTwitterHandle(handle: string): string | undefined {
    const trimmed = handle.trim();
    if (!trimmed) {
        return undefined;
    }

    return trimmed.startsWith("@") ? trimmed : `@${trimmed}`;
}

function resolveAssetUrl(value: string, metadataBase?: URL): string | undefined {
    const trimmed = value.trim();
    if (!trimmed) {
        return undefined;
    }

    if (trimmed.startsWith("http://") || trimmed.startsWith("https://")) {
        return trimmed;
    }

    if (trimmed.startsWith("/") && metadataBase) {
        return new URL(trimmed, metadataBase).toString();
    }

    return trimmed;
}

function getIconType(url: string): string {
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

export function buildRootMetadata(branding: BrandingSettings): Metadata {
    const metadataBase = resolveSiteUrl();
    const ogImage = resolveAssetUrl(branding.ogImageUrl, metadataBase);
    const favicon = resolveAssetUrl(branding.faviconUrl, metadataBase) ?? "/favicon.ico";
    const faviconType = getIconType(favicon);
    const appleIcons = faviconType === "image/png" ? [{ url: favicon, type: "image/png" }] : undefined;
    const twitterHandle = normalizeTwitterHandle(branding.twitterHandle);
    const googleSiteVerification =
        process.env.GOOGLE_SITE_VERIFICATION?.trim() || undefined;

    return {
        metadataBase,
        applicationName: branding.siteShortName,
        title: {
            default: branding.defaultTitle,
            template: branding.titleTemplate,
        },
        description: branding.defaultDescription,
        alternates: {
            canonical: buildCanonicalUrl("/"),
        },
        openGraph: {
            title: branding.defaultTitle,
            description: branding.defaultDescription,
            type: "website",
            locale: "tr_TR",
            siteName: branding.siteName,
            images: ogImage ? [{ url: ogImage }] : undefined,
        },
        twitter: {
            card: ogImage ? "summary_large_image" : "summary",
            title: branding.defaultTitle,
            description: branding.defaultDescription,
            creator: twitterHandle,
            images: ogImage ? [ogImage] : undefined,
        },
        icons: {
            icon: [{ url: favicon, type: faviconType }],
            shortcut: [{ url: favicon, type: faviconType }],
            apple: appleIcons,
        },
        verification: googleSiteVerification
            ? { google: googleSiteVerification }
            : undefined,
    };
}

export function buildRootViewport(branding: BrandingSettings): Viewport {
    return {
        themeColor: branding.themeColor,
    };
}

export function buildRoomMetadata(branding: BrandingSettings): Metadata {
    const metadataBase = resolveSiteUrl();
    const ogImage = resolveAssetUrl(branding.ogImageUrl, metadataBase);
    const roomTitle = `Oyun Odasi | ${branding.siteName}`;
    const roomDescription = `Online ${branding.siteName} odasi. Takiminla birlikte yasakli kelimelere dikkat ederek anlatmaya calis.`;

    return {
        title: roomTitle,
        description: roomDescription,
        robots: {
            index: false,
            follow: false,
            googleBot: {
                index: false,
                follow: false,
            },
        },
        openGraph: {
            title: branding.defaultTitle,
            description: branding.defaultDescription,
            type: "website",
            siteName: branding.siteName,
            images: ogImage ? [{ url: ogImage }] : undefined,
        },
        twitter: {
            card: ogImage ? "summary_large_image" : "summary",
            title: branding.defaultTitle,
            description: branding.defaultDescription,
            images: ogImage ? [ogImage] : undefined,
        },
    };
}

export function buildUtilityPageMetadata(options: {
    branding: BrandingSettings;
    title: string;
    description: string;
    pathname: string;
    noIndex?: boolean;
}): Metadata {
    const { branding, title, description, pathname, noIndex = false } = options;
    const metadataBase = resolveSiteUrl();
    const ogImage = resolveAssetUrl(branding.ogImageUrl, metadataBase);

    return {
        title,
        description,
        alternates: {
            canonical: buildCanonicalUrl(pathname),
        },
        robots: noIndex
            ? {
                  index: false,
                  follow: false,
                  googleBot: {
                      index: false,
                      follow: false,
                  },
              }
            : undefined,
        openGraph: {
            title,
            description,
            type: "website",
            siteName: branding.siteName,
            images: ogImage ? [{ url: ogImage }] : undefined,
        },
        twitter: {
            card: ogImage ? "summary_large_image" : "summary",
            title,
            description,
            images: ogImage ? [ogImage] : undefined,
        },
    };
}
