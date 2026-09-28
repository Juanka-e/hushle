import type { MetadataRoute } from "next";
import { buildCanonicalUrl } from "@/lib/branding/metadata";

export default function robots(): MetadataRoute.Robots {
    const sitemap = buildCanonicalUrl("/sitemap.xml");
    const host = buildCanonicalUrl("/");

    return {
        rules: [
            {
                userAgent: "*",
                allow: "/",
                disallow: ["/admin", "/api", "/login", "/register", "/dashboard", "/profile", "/store"],
            },
        ],
        sitemap: sitemap ? [sitemap] : undefined,
        host: host ?? undefined,
    };
}
