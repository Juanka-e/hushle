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

const updateAnnouncementSchema = z.object({
    translations: announcementTranslationsSchema.optional(),
    type: announcementTypeSchema.optional(),
    isVisible: z.boolean().optional(),
    isPinned: z.boolean().optional(),
    version: z.string().trim().max(50).nullable().optional(),
    tags: z.string().trim().max(500).nullable().optional(),
    mediaUrl: z.string().trim().max(ANNOUNCEMENT_MEDIA_URL_MAX_LENGTH).nullable().optional(),
    mediaType: z.enum(["image", "youtube"]).nullable().optional(),
});

export async function PUT(
    request: NextRequest,
    { params }: { params: Promise<{ id: string }> }
) {
    const adminSession = await requireAdminSession();
    if (adminSession instanceof NextResponse) {
        return adminSession;
    }

    const rateLimit = await consumeDistributedRequestRateLimit({
        bucket: "admin-announcement-update",
        key: `admin:${adminSession.id}:${getRequestIp(request)}`,
        windowMs: 60_000,
        maxRequests: 30,
    });
    if (!rateLimit.allowed) {
        return NextResponse.json(
            { error: "Cok fazla duyuru guncelleme denemesi. Lutfen biraz bekleyin." },
            { status: 429, headers: buildRateLimitHeaders(rateLimit) }
        );
    }

    try {
        const { id } = await params;
        const body = await request.json();
        const parsedBody = updateAnnouncementSchema.parse(body);
        const sanitizedMedia = sanitizeAnnouncementMedia(
            parsedBody.mediaUrl,
            toAnnouncementMediaType(parsedBody.mediaType)
        );

        const data: Record<string, unknown> = {};

        if (parsedBody.type !== undefined) data.type = parsedBody.type;
        if (parsedBody.isVisible !== undefined) data.isVisible = parsedBody.isVisible;
        if (parsedBody.isPinned !== undefined) data.isPinned = parsedBody.isPinned;
        if (parsedBody.version !== undefined) data.version = parsedBody.version || null;
        if (parsedBody.tags !== undefined) data.tags = parsedBody.tags || null;

        if (parsedBody.translations !== undefined) {
            const turkish = parsedBody.translations.tr;
            data.title = turkish.title;
            data.contentBlocks = toAnnouncementInputJson(turkish.contentBlocks);
            data.content = announcementBlocksToHtml(turkish.contentBlocks);
        }

        if (parsedBody.mediaUrl !== undefined || parsedBody.mediaType !== undefined) {
            data.mediaUrl = sanitizedMedia.mediaUrl;
            data.mediaType = sanitizedMedia.mediaType;
        }

        const announcementId = Number.parseInt(id, 10);
        const announcement = await prisma.$transaction(async (transaction) => {
            const updated = await transaction.announcement.update({
                where: { id: announcementId },
                data,
            });

            if (parsedBody.translations) {
                const turkish = parsedBody.translations.tr;
                await transaction.announcementTranslation.upsert({
                    where: {
                        announcementId_locale: { announcementId, locale: "tr" },
                    },
                    create: {
                        announcementId,
                        locale: "tr",
                        title: turkish.title,
                        content: announcementBlocksToHtml(turkish.contentBlocks),
                        contentBlocks: toAnnouncementInputJson(turkish.contentBlocks),
                    },
                    update: {
                        title: turkish.title,
                        content: announcementBlocksToHtml(turkish.contentBlocks),
                        contentBlocks: toAnnouncementInputJson(turkish.contentBlocks),
                    },
                });

                const english = parsedBody.translations.en;
                if (english) {
                    await transaction.announcementTranslation.upsert({
                        where: {
                            announcementId_locale: { announcementId, locale: "en" },
                        },
                        create: {
                            announcementId,
                            locale: "en",
                            title: english.title,
                            content: announcementBlocksToHtml(english.contentBlocks),
                            contentBlocks: toAnnouncementInputJson(english.contentBlocks),
                        },
                        update: {
                            title: english.title,
                            content: announcementBlocksToHtml(english.contentBlocks),
                            contentBlocks: toAnnouncementInputJson(english.contentBlocks),
                        },
                    });
                } else {
                    await transaction.announcementTranslation.deleteMany({
                        where: { announcementId, locale: "en" },
                    });
                }
            }

            return updated;
        });

        await writeAuditLog({
            actor: adminSession,
            action: "admin.announcement.update",
            resourceType: "announcement",
            resourceId: announcement.id,
            summary: `Updated announcement ${announcement.title}`,
            metadata: {
                isVisible: announcement.isVisible,
                isPinned: announcement.isPinned,
            },
            request,
        });

        return NextResponse.json(announcement, { headers: buildRateLimitHeaders(rateLimit) });
    } catch (error) {
        if (error instanceof z.ZodError) {
            return NextResponse.json(
                { error: "Gecersiz veri.", details: error.issues },
                { status: 400 }
            );
        }

        console.error("Failed to update announcement:", error);
        return NextResponse.json(
            { error: "Duyuru guncellenemedi." },
            { status: 500 }
        );
    }
}

export async function DELETE(
    request: NextRequest,
    { params }: { params: Promise<{ id: string }> }
) {
    const adminSession = await requireAdminSession();
    if (adminSession instanceof NextResponse) {
        return adminSession;
    }

    const rateLimit = await consumeDistributedRequestRateLimit({
        bucket: "admin-announcement-delete",
        key: `admin:${adminSession.id}:${getRequestIp(request)}`,
        windowMs: 60_000,
        maxRequests: 20,
    });
    if (!rateLimit.allowed) {
        return NextResponse.json(
            { error: "Cok fazla duyuru silme denemesi. Lutfen biraz bekleyin." },
            { status: 429, headers: buildRateLimitHeaders(rateLimit) }
        );
    }

    try {
        const { id } = await params;
        const deletedId = Number.parseInt(id, 10);

        await prisma.announcement.delete({ where: { id: deletedId } });

        await writeAuditLog({
            actor: adminSession,
            action: "admin.announcement.delete",
            resourceType: "announcement",
            resourceId: deletedId,
            summary: `Deleted announcement ${deletedId}`,
            request,
        });

        return NextResponse.json({ success: true }, { headers: buildRateLimitHeaders(rateLimit) });
    } catch (error) {
        console.error("Failed to delete announcement:", error);
        return NextResponse.json(
            { error: "Duyuru silinemedi." },
            { status: 500 }
        );
    }
}
