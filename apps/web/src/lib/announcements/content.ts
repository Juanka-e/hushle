import { z } from "zod";
import type { Prisma } from "@hushle/platform-db";
import { sanitizeAnnouncementContent } from "@/lib/security/announcements";

export const ANNOUNCEMENT_BLOCK_TYPES = [
    "paragraph",
    "heading",
    "quote",
    "bullet_list",
    "ordered_list",
    "divider",
] as const;

export type AnnouncementBlockType = (typeof ANNOUNCEMENT_BLOCK_TYPES)[number];

export const ANNOUNCEMENT_BODY_TEXT_MAX_LENGTH = 700;
export const ANNOUNCEMENT_HEADING_TEXT_MAX_LENGTH = 120;
export const ANNOUNCEMENT_LIST_ITEM_MAX_LENGTH = 220;

const cleanBodyText = z
    .string()
    .trim()
    .min(1)
    .max(ANNOUNCEMENT_BODY_TEXT_MAX_LENGTH)
    .transform((value) => value.replace(/\s+/g, " ").trim());

const listItemText = z
    .string()
    .trim()
    .min(1)
    .max(ANNOUNCEMENT_LIST_ITEM_MAX_LENGTH)
    .transform((value) => value.replace(/\s+/g, " ").trim());

const headingText = z
    .string()
    .trim()
    .min(1)
    .max(ANNOUNCEMENT_HEADING_TEXT_MAX_LENGTH)
    .transform((value) => value.replace(/\s+/g, " ").trim());

const paragraphBlockSchema = z.object({
    type: z.literal("paragraph"),
    text: cleanBodyText,
});

const quoteBlockSchema = z.object({
    type: z.literal("quote"),
    text: cleanBodyText,
});

const headingBlockSchema = z.object({
    type: z.literal("heading"),
    text: headingText,
    level: z.union([z.literal(2), z.literal(3)]).default(2),
});

const listBlockSchema = z.object({
    type: z.union([z.literal("bullet_list"), z.literal("ordered_list")]),
    items: z.array(listItemText).min(1).max(12),
});

const dividerBlockSchema = z.object({
    type: z.literal("divider"),
});

export const announcementBlockSchema = z.discriminatedUnion("type", [
    paragraphBlockSchema,
    quoteBlockSchema,
    headingBlockSchema,
    listBlockSchema,
    dividerBlockSchema,
]);

export const announcementBlocksSchema = z
    .array(announcementBlockSchema)
    .min(1)
    .max(24)
    .refine(
        (blocks) =>
            blocks.some((block) => {
                if ("text" in block) {
                    return block.text.trim().length > 0;
                }

                if ("items" in block) {
                    return block.items.some((item) => item.trim().length > 0);
                }

                return block.type === "divider";
            }),
        "En az bir icerik blogu gerekli."
    );

export type AnnouncementBlock = z.infer<typeof announcementBlockSchema>;
export type AnnouncementBlocks = z.infer<typeof announcementBlocksSchema>;

export function createEmptyAnnouncementBlocks(): AnnouncementBlocks {
    return [{ type: "paragraph", text: "Yeni duyuru metni" }];
}

function escapeHtml(value: string): string {
    return value
        .replace(/&/g, "&amp;")
        .replace(/</g, "&lt;")
        .replace(/>/g, "&gt;")
        .replace(/"/g, "&quot;")
        .replace(/'/g, "&#39;");
}

export function announcementBlocksToHtml(blocks: AnnouncementBlocks): string {
    return blocks
        .map((block) => {
            switch (block.type) {
                case "paragraph":
                    return `<p>${escapeHtml(block.text)}</p>`;
                case "quote":
                    return `<blockquote>${escapeHtml(block.text)}</blockquote>`;
                case "heading":
                    return `<h${block.level}>${escapeHtml(block.text)}</h${block.level}>`;
                case "bullet_list":
                    return `<ul>${block.items
                        .map((item) => `<li>${escapeHtml(item)}</li>`)
                        .join("")}</ul>`;
                case "ordered_list":
                    return `<ol>${block.items
                        .map((item) => `<li>${escapeHtml(item)}</li>`)
                        .join("")}</ol>`;
                case "divider":
                    return "<hr>";
                default:
                    return "";
            }
        })
        .join("");
}

export function announcementBlocksToPreview(blocks: AnnouncementBlocks): string {
    for (const block of blocks) {
        if ("text" in block) {
            return block.text.slice(0, 180);
        }

        if ("items" in block) {
            return block.items.join(" • ").slice(0, 180);
        }
    }

    return "";
}

function stripTags(value: string): string {
    return value
        .replace(/<br\s*\/?>/gi, "\n")
        .replace(/<\/p>|<\/blockquote>|<\/h2>|<\/h3>/gi, "\n")
        .replace(/<li>/gi, "")
        .replace(/<\/li>/gi, "\n")
        .replace(/<[^>]*>/g, "")
        .replace(/&nbsp;/gi, " ")
        .trim();
}

function legacyHtmlToAnnouncementBlocks(html: string): AnnouncementBlocks {
    const sanitizedHtml = sanitizeAnnouncementContent(html);
    const blocks: AnnouncementBlock[] = [];
    const blockPattern =
        /<h2>[\s\S]*?<\/h2>|<h3>[\s\S]*?<\/h3>|<blockquote>[\s\S]*?<\/blockquote>|<p>[\s\S]*?<\/p>|<(ul|ol)>[\s\S]*?<\/\1>|<hr\s*\/?>/gi;
    let lastIndex = 0;
    let match: RegExpExecArray | null;

    while ((match = blockPattern.exec(sanitizedHtml)) !== null) {
        const [fullMatch] = match;
        const textBefore = sanitizedHtml.slice(lastIndex, match.index);
        const paragraphLines = stripTags(textBefore)
            .split(/\n+/)
            .map((line) => line.trim())
            .filter(Boolean);

        for (const line of paragraphLines) {
            blocks.push({ type: "paragraph", text: line });
        }

        const tagMatch = fullMatch.match(/^<([a-z0-9]+)/i);
        const tagName = tagMatch?.[1]?.toLowerCase();

        if (tagName === "h2" || tagName === "h3") {
            blocks.push({
                type: "heading",
                level: tagName === "h3" ? 3 : 2,
                text: stripTags(fullMatch),
            });
        } else if (tagName === "blockquote") {
            blocks.push({
                type: "quote",
                text: stripTags(fullMatch),
            });
        } else if (tagName === "ul" || tagName === "ol") {
            const items = Array.from(fullMatch.matchAll(/<li>([\s\S]*?)<\/li>/gi))
                .map((itemMatch) => stripTags(itemMatch[1] ?? ""))
                .map((item) => item.trim())
                .filter(Boolean);

            if (items.length > 0) {
                blocks.push({
                    type: tagName === "ol" ? "ordered_list" : "bullet_list",
                    items,
                });
            }
        } else if (tagName === "hr") {
            blocks.push({ type: "divider" });
        } else {
            const text = stripTags(fullMatch);
            if (text) {
                blocks.push({ type: "paragraph", text });
            }
        }

        lastIndex = match.index + fullMatch.length;
    }

    const trailingLines = stripTags(sanitizedHtml.slice(lastIndex))
        .split(/\n+/)
        .map((line) => line.trim())
        .filter(Boolean);

    for (const line of trailingLines) {
        blocks.push({ type: "paragraph", text: line });
    }

    const parsed = announcementBlocksSchema.safeParse(
        blocks.filter((block, index, array) => {
            if (block.type !== "divider") {
                return true;
            }

            return index > 0 && index < array.length - 1;
        })
    );

    if (parsed.success) {
        return parsed.data;
    }

    return [{ type: "paragraph", text: stripTags(sanitizedHtml) || "Icerik yok." }];
}

export function normalizeAnnouncementBlocks(
    contentBlocks: Prisma.JsonValue | null | undefined,
    legacyHtml: string
): AnnouncementBlocks {
    const parsed = announcementBlocksSchema.safeParse(contentBlocks);
    if (parsed.success) {
        return parsed.data;
    }

    return legacyHtmlToAnnouncementBlocks(legacyHtml);
}

export function toAnnouncementInputJson(
    blocks: AnnouncementBlocks
): Prisma.InputJsonValue {
    return blocks as unknown as Prisma.InputJsonValue;
}

