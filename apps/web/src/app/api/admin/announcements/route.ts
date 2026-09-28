import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { prisma } from "@/lib/prisma";
import { requireAdminSession } from "@/lib/admin/require-admin";
import { writeAuditLog } from "@/lib/security/audit-log";
import {
    buildRateLimitHeaders,
    consumeDistributedRequestRateLimit,
    getRequestIp,
} from "@/lib/security/request-rate-limit";
import {
    announcementBlocksToHtml,
    announcementBlocksToPreview,
    normalizeAnnouncementBlocks,
    toAnnouncementInputJson,
} from "@/lib/announcements/content";
import {
    ANNOUNCEMENT_MEDIA_URL_MAX_LENGTH,
    sanitizeAnnouncementMedia,
    toAnnouncementMediaType,
} from "@/lib/security/announcements";
import {
    announcementTranslationsSchema,
    announcementTypeSchema,
} from "@/lib/announcements/localization";

export const dynamic = "force-dynamic";

const createAnnouncementSchema = z.object({
    translations: announcementTranslationsSchema,
    type: announcementTypeSchema.default("guncelleme"),
    isVisible: z.boolean().default(true),
    isPinned: z.boolean().default(false),
    version: z.string().trim().max(50).nullable().optional(),
    tags: z.string().trim().max(500).nullable().optional(),
    mediaUrl: z.string().trim().max(ANNOUNCEMENT_MEDIA_URL_MAX_LENGTH).nullable().optional(),
    mediaType: z.enum(["image", "youtube"]).nullable().optional(),
});

export async function GET(request: NextRequest) {
    const adminSession = await requireAdminSession();
    if (adminSession instanceof NextResponse) {
        return adminSession;
    }

    const rateLimit = await consumeDistributedRequestRateLimit({
        bucket: "admin-announcements-read",
        key: `${adminSession.id}:${getRequestIp(request)}`,
        windowMs: 60_000,
        maxRequests: 90,
    });

    if (!rateLimit.allowed) {
        return NextResponse.json(
            { error: "Cok fazla istek gonderildi. Lutfen bekleyin." },
            {
                status: 429,
                headers: buildRateLimitHeaders(rateLimit),
            }
        );
    }

    const announcements = await prisma.announcement.findMany({
        orderBy: [{ isPinned: "desc" }, { createdAt: "desc" }],
        include: { translations: true },
    });

    return NextResponse.json(
        announcements.map((announcement) => {
            const sanitizedMedia = sanitizeAnnouncementMedia(
                announcement.mediaUrl,
                toAnnouncementMediaType(announcement.mediaType)
            );
            const contentBlocks = normalizeAnnouncementBlocks(
                announcement.contentBlocks,
                announcement.content
            );
            const translations = Object.fromEntries(
                announcement.translations.map((translation) => {
                    const blocks = normalizeAnnouncementBlocks(
                        translation.contentBlocks,
                        translation.content
                    );
                    return [
                        translation.locale,
                        {
                            title: translation.title,
                            contentBlocks: blocks,
                            contentPreview: announcementBlocksToPreview(blocks),
                        },
                    ];
                })
            );

            if (!translations.tr) {
                translations.tr = {
                    title: announcement.title,
                    contentBlocks,
                    contentPreview: announcementBlocksToPreview(contentBlocks),
                };
            }

            return {
                ...announcement,
                translations,
                contentBlocks,
                contentPreview: announcementBlocksToPreview(contentBlocks),
                mediaUrl: sanitizedMedia.mediaUrl,
                mediaType: sanitizedMedia.mediaType,
            };
        }),
        { headers: buildRateLimitHeaders(rateLimit) }
    );
}

export async function POST(request: NextRequest) {
    const adminSession = await requireAdminSession();
    if (adminSession instanceof NextResponse) {
        return adminSession;
    }

    const rateLimit = await consumeDistributedRequestRateLimit({
        bucket: "admin-announcements-write",
        key: `${adminSession.id}:${getRequestIp(request)}`,
        windowMs: 60_000,
        maxRequests: 30,
    });
    if (!rateLimit.allowed) {
        return NextResponse.json(
            { error: "Cok fazla duyuru olusturma denemesi. Lutfen biraz bekleyin." },
            { status: 429, headers: buildRateLimitHeaders(rateLimit) }
        );
    }

    try {
        const body = await request.json();
        const data = createAnnouncementSchema.parse(body);
        const turkish = data.translations.tr;
        const english = data.translations.en;
        const sanitizedMedia = sanitizeAnnouncementMedia(
            data.mediaUrl,
            toAnnouncementMediaType(data.mediaType)
        );
        const htmlContent = announcementBlocksToHtml(turkish.contentBlocks);

        const announcement = await prisma.announcement.create({
            data: {
                title: turkish.title,
                content: htmlContent,
                contentBlocks: toAnnouncementInputJson(turkish.contentBlocks),
                type: data.type,
                isVisible: data.isVisible,
                isPinned: data.isPinned,
                version: data.version || null,
                tags: data.tags || null,
                mediaUrl: sanitizedMedia.mediaUrl,
                mediaType: sanitizedMedia.mediaType,
                translations: {
                    create: [
                        {
                            locale: "tr",
                            title: turkish.title,
                            content: htmlContent,
                            contentBlocks: toAnnouncementInputJson(turkish.contentBlocks),
                        },
                        ...(english
                            ? [{
                                  locale: "en",
                                  title: english.title,
                                  content: announcementBlocksToHtml(english.contentBlocks),
                                  contentBlocks: toAnnouncementInputJson(english.contentBlocks),
                              }]
                            : []),
                    ],
                },
            },
            include: { translations: true },
        });

        await writeAuditLog({
            actor: adminSession,
            action: "admin.announcement.create",
            resourceType: "announcement",
            resourceId: announcement.id,
            summary: `Created announcement ${announcement.title}`,
            metadata: {
                type: announcement.type,
                isVisible: announcement.isVisible,
                isPinned: announcement.isPinned,
            },
            request,
        });

        return NextResponse.json(announcement, {
            status: 201,
            headers: buildRateLimitHeaders(rateLimit),
        });
    } catch (error) {
        if (error instanceof z.ZodError) {
            return NextResponse.json(
                { error: "Gecersiz veri.", details: error.issues },
                { status: 400 }
            );
        }

        console.error("Failed to create announcement:", error);
        return NextResponse.json(
            { error: "Duyuru olusturulamadi." },
            { status: 500 }
        );
    }
}
