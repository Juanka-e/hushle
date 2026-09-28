export type AnnouncementMediaType = "image" | "youtube" | null;
export const ANNOUNCEMENT_MEDIA_URL_MAX_LENGTH = 2_048;

export function toAnnouncementMediaType(value: string | null | undefined): AnnouncementMediaType {
    return value === "image" || value === "youtube" ? value : null;
}

const BLOCK_TAGS = ["script", "style", "iframe", "object", "embed", "svg", "math", "form"];
const STRIP_ONLY_TAGS = ["input", "button", "textarea", "select", "option", "link", "meta"];
const ALLOWED_TAGS = new Set([
    "p",
    "br",
    "strong",
    "em",
    "ul",
    "ol",
    "li",
    "h2",
    "h3",
    "blockquote",
    "a",
    "img",
    "hr",
]);

const IMAGE_EXTENSIONS = [".png", ".jpg", ".jpeg", ".webp", ".gif"];

function hasAllowedImageExtension(value: string): boolean {
    const lowerValue = value.toLowerCase();
    return IMAGE_EXTENSIONS.some((extension) => lowerValue.endsWith(extension));
}

function sanitizeLinkUrl(value: string): string | null {
    const trimmedValue = value.trim();
    if (!trimmedValue) {
        return null;
    }

    if (trimmedValue.startsWith("/") && !trimmedValue.startsWith("//")) {
        return trimmedValue;
    }

    try {
        const url = new URL(trimmedValue);
        if (url.protocol !== "https:") {
            return null;
        }

        return url.toString();
    } catch {
        return null;
    }
}

function sanitizeImageUrl(value: string): string | null {
    const safeUrl = sanitizeLinkUrl(value);
    if (!safeUrl) {
        return null;
    }

    if (safeUrl.startsWith("/")) {
        return hasAllowedImageExtension(safeUrl) ? safeUrl : null;
    }

    return hasAllowedImageExtension(new URL(safeUrl).pathname) ? safeUrl : null;
}

function sanitizeTagAttributes(tagName: string, rawAttributes: string): string {
    const attributePattern = /([a-zA-Z0-9:-]+)\s*=\s*(".*?"|'.*?'|[^\s>]+)/g;
    const attributes: string[] = [];

    let match = attributePattern.exec(rawAttributes);
    while (match) {
        const attributeName = match[1].toLowerCase();
        const rawValue = match[2] ?? "";
        const unquotedValue = rawValue.replace(/^['"]|['"]$/g, "");

        if (attributeName.startsWith("on") || attributeName === "style") {
            match = attributePattern.exec(rawAttributes);
            continue;
        }

        if (tagName === "a" && attributeName === "href") {
            const safeHref = sanitizeLinkUrl(unquotedValue);
            if (safeHref) {
                attributes.push(` href="${safeHref}"`);
                if (!safeHref.startsWith("/")) {
                    attributes.push(' target="_blank"');
                    attributes.push(' rel="noopener noreferrer nofollow"');
                }
            }
        }

        if (tagName === "img" && attributeName === "src") {
            const safeSrc = sanitizeImageUrl(unquotedValue);
            if (safeSrc) {
                attributes.push(` src="${safeSrc}"`);
            }
        }

        if (tagName === "img" && attributeName === "alt") {
            const sanitizedAlt = unquotedValue.replace(/[<>"]/g, "").slice(0, 160);
            attributes.push(` alt="${sanitizedAlt}"`);
        }

        match = attributePattern.exec(rawAttributes);
    }

    return Array.from(new Set(attributes)).join("");
}

export function sanitizeAnnouncementContent(content: string): string {
    let sanitized = content.replace(/\0/g, "").replace(/<!--[\s\S]*?-->/g, "");

    for (const tagName of BLOCK_TAGS) {
        const blockPattern = new RegExp(`<${tagName}\\b[^>]*>[\\s\\S]*?<\\/${tagName}>`, "gi");
        const selfClosingPattern = new RegExp(`<${tagName}\\b[^>]*\\/?>`, "gi");
        sanitized = sanitized.replace(blockPattern, "");
        sanitized = sanitized.replace(selfClosingPattern, "");
    }

    for (const tagName of STRIP_ONLY_TAGS) {
        const tagPattern = new RegExp(`<\\/?${tagName}\\b[^>]*>`, "gi");
        sanitized = sanitized.replace(tagPattern, "");
    }

    sanitized = sanitized.replace(/javascript:/gi, "");
    sanitized = sanitized.replace(/data:/gi, "");

    sanitized = sanitized.replace(/<\/?([a-z0-9-]+)([^>]*)>/gi, (fullMatch, rawTagName, rawAttributes) => {
        const tagName = String(rawTagName).toLowerCase();
        const isClosingTag = fullMatch.startsWith("</");

        if (!ALLOWED_TAGS.has(tagName)) {
            return "";
        }

        if (isClosingTag) {
            return `</${tagName}>`;
        }

        if (tagName === "br" || tagName === "hr") {
            return `<${tagName}>`;
        }

        const sanitizedAttributes = sanitizeTagAttributes(tagName, String(rawAttributes ?? ""));
        return `<${tagName}${sanitizedAttributes}>`;
    });

    return sanitized.trim();
}

function extractYoutubeEmbedUrl(value: string): string | null {
    try {
        const url = new URL(value);
        if (url.protocol !== "https:") {
            return null;
        }

        if (url.hostname === "youtu.be") {
            const videoId = url.pathname.slice(1);
            return isValidYoutubeVideoId(videoId)
                ? `https://www.youtube.com/embed/${videoId}`
                : null;
        }

        if (url.hostname === "www.youtube.com" || url.hostname === "youtube.com") {
            if (url.pathname === "/watch") {
                const videoId = url.searchParams.get("v");
                return isValidYoutubeVideoId(videoId)
                    ? `https://www.youtube.com/embed/${videoId}`
                    : null;
            }

            if (url.pathname.startsWith("/embed/")) {
                const videoId = url.pathname.slice("/embed/".length);
                return isValidYoutubeVideoId(videoId)
                    ? `https://www.youtube.com/embed/${videoId}`
                    : null;
            }
        }

        return null;
    } catch {
        return null;
    }
}

function isValidYoutubeVideoId(value: string | null): value is string {
    return typeof value === "string" && /^[A-Za-z0-9_-]{6,64}$/.test(value);
}

export function sanitizeAnnouncementMedia(
    mediaUrl: string | null | undefined,
    mediaType: AnnouncementMediaType
): { mediaUrl: string | null; mediaType: AnnouncementMediaType } {
    if (!mediaUrl || !mediaType) {
        return { mediaUrl: null, mediaType: null };
    }

    if (mediaUrl.length > ANNOUNCEMENT_MEDIA_URL_MAX_LENGTH) {
        return { mediaUrl: null, mediaType: null };
    }

    if (mediaType === "youtube") {
        const safeYoutubeUrl = extractYoutubeEmbedUrl(mediaUrl);
        return safeYoutubeUrl
            ? { mediaUrl: safeYoutubeUrl, mediaType }
            : { mediaUrl: null, mediaType: null };
    }

    const safeImageUrl = sanitizeImageUrl(mediaUrl);
    return safeImageUrl
        ? { mediaUrl: safeImageUrl, mediaType }
        : { mediaUrl: null, mediaType: null };
}
