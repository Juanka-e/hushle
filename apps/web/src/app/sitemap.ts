import type { MetadataRoute } from "next";
import { buildCanonicalUrl } from "@/lib/branding/metadata";

export default function sitemap(): MetadataRoute.Sitemap {
    const homepage = buildCanonicalUrl("/");
    if (!homepage) {
        return [];
    }

    return [
        {
            url: homepage,
            changeFrequency: "daily",
            priority: 1,
        },
    ];
}
