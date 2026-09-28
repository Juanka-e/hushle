import assert from "node:assert/strict";
import { isAutomaticBrandingPreviewUrl } from "@/lib/branding/assets";
import {
    buildRootMetadata,
    buildRootViewport,
    buildRoomMetadata,
} from "@/lib/branding/metadata";
import {
    DEFAULT_SYSTEM_SETTINGS,
    normalizeSystemSettings,
} from "@/lib/system-settings/schema";

function main() {
    const previousGoogleVerification = process.env.GOOGLE_SITE_VERIFICATION;
    process.env.GOOGLE_SITE_VERIFICATION = "search-console-test-token";

    const settings = normalizeSystemSettings({
        ...DEFAULT_SYSTEM_SETTINGS,
        branding: {
            ...DEFAULT_SYSTEM_SETTINGS.branding,
            siteName: "Tabu Arena",
            siteShortName: "Arena",
            logoUrl: "/branding/logo/tabu-arena.webp",
            defaultTitle: "Tabu Arena | Online Oyun",
            titleTemplate: "%s | Tabu Arena",
            defaultDescription: "Modern online Tabu deneyimi.",
            ogImageUrl: "/og/tabu-arena.png",
            faviconUrl: "/brand/favicon.ico",
            themeColor: "#123456",
            twitterHandle: "tabuarena",
        },
    });

    const rootMetadata = buildRootMetadata(settings.branding);
    const rootViewport = buildRootViewport(settings.branding);
    const roomMetadata = buildRoomMetadata(settings.branding);
    const titleConfig =
        typeof rootMetadata.title === "object" && rootMetadata.title
            ? (rootMetadata.title as { template?: string })
            : null;
    const iconsConfig =
        typeof rootMetadata.icons === "object" && rootMetadata.icons
            ? (rootMetadata.icons as { icon?: Array<{ url: string; type?: string }>; apple?: Array<{ url: string; type?: string }> })
            : null;

    assert.equal(settings.branding.siteName, "Tabu Arena");
    assert.equal(settings.branding.logoUrl, "/branding/logo/tabu-arena.webp");
    assert.equal(rootMetadata.applicationName, "Arena");
    assert.equal(rootViewport.themeColor, "#123456");
    assert.equal(titleConfig?.template, "%s | Tabu Arena");
    assert.equal(rootMetadata.openGraph?.siteName, "Tabu Arena");
    assert.equal(rootMetadata.twitter?.creator, "@tabuarena");
    assert.equal(
        (rootMetadata.verification as { google?: string } | undefined)?.google,
        "search-console-test-token"
    );
    assert.equal(iconsConfig?.icon?.[0]?.url, "http://localhost:3000/brand/favicon.ico");
    assert.equal(iconsConfig?.icon?.[0]?.type, "image/x-icon");
    assert.equal(iconsConfig?.apple, undefined);
    assert.equal(roomMetadata.title, "Oyun Odasi | Tabu Arena");
    assert.equal(roomMetadata.openGraph?.title, "Tabu Arena | Online Oyun");
    assert.equal(isAutomaticBrandingPreviewUrl("/og/tabu-arena.png"), true);
    assert.equal(isAutomaticBrandingPreviewUrl("https://cdn.example.com/tabu.png"), false);

    if (previousGoogleVerification === undefined) {
        delete process.env.GOOGLE_SITE_VERIFICATION;
    } else {
        process.env.GOOGLE_SITE_VERIFICATION = previousGoogleVerification;
    }

    console.log("branding seo settings smoke test passed");
}

main();
