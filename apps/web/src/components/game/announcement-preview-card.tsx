"use client";

import { Clock3, Pin, Star, Tag } from "lucide-react";
import { AnnouncementBlocksView } from "@/components/game/announcement-blocks-view";
import type { AnnouncementBlocks } from "@/lib/announcements/content";
import { useI18n } from "@/components/providers/i18n-provider";
import { toIntlLocale } from "@/lib/i18n/config";

interface AnnouncementPreviewCardProps {
    title: string;
    contentBlocks: AnnouncementBlocks;
    createdAt: string;
    isPinned?: boolean;
    isNew?: boolean;
    version?: string | null;
    tags?: string | null;
    mediaUrl?: string | null;
    mediaType?: "image" | "youtube" | null;
    showContentPreview?: boolean;
    clipped?: boolean;
    className?: string;
}

function cx(...parts: Array<string | false | null | undefined>) {
    return parts.filter(Boolean).join(" ");
}

export function AnnouncementPreviewCard({
    title,
    contentBlocks,
    createdAt,
    isPinned = false,
    isNew = false,
    version,
    tags,
    mediaUrl,
    mediaType,
    showContentPreview = false,
    clipped = true,
    className,
}: AnnouncementPreviewCardProps) {
    const { locale, t } = useI18n();
    const tagList = tags
        ? tags.split(",").map((tag) => tag.trim()).filter(Boolean)
        : [];

    return (
        <div
            className={cx(
                "overflow-hidden rounded-2xl border border-gray-200 bg-white p-4 text-slate-900 shadow-sm transition-colors dark:border-slate-700 dark:bg-slate-900 dark:text-slate-100",
                className
            )}
        >
            <div className="flex items-start justify-between gap-4">
                <div className="min-w-0 flex-1">
                    <div className="mb-2 flex flex-wrap items-center gap-2">
                        {isPinned ? (
                            <span className="inline-flex items-center gap-1 rounded-full bg-amber-400 px-2 py-1 text-[10px] font-black text-white">
                                <Pin size={10} fill="currentColor" />
                                {t("announcements.pinned").toUpperCase()}
                            </span>
                        ) : null}
                        {isNew ? (
                            <span className="inline-flex items-center gap-1 rounded-full bg-blue-500 px-2 py-1 text-[10px] font-black text-white">
                                <Star size={10} fill="currentColor" />
                                {t("announcements.new").toUpperCase()}
                            </span>
                        ) : null}
                        {version ? (
                            <span className="rounded bg-gray-100 px-2 py-1 font-mono text-[10px] text-gray-600 dark:bg-slate-700 dark:text-slate-300">
                                {version}
                            </span>
                        ) : null}
                        {mediaUrl ? (
                            <span className="rounded bg-gray-100 px-2 py-1 text-[10px] font-semibold uppercase tracking-wide text-gray-500 dark:bg-slate-700 dark:text-slate-300">
                                {mediaType === "youtube" ? t("common.video") : t("common.image")}
                            </span>
                        ) : null}
                        {tagList.map((tag) => (
                            <span
                                key={tag}
                                className="inline-flex items-center gap-1 rounded bg-gray-100 px-2 py-1 text-[10px] font-semibold uppercase tracking-wide text-gray-500 dark:bg-slate-700 dark:text-slate-300"
                            >
                                <Tag size={10} />
                                {tag}
                            </span>
                        ))}
                    </div>

                    <h3 className="text-base font-black text-slate-900 dark:text-white">{title}</h3>

                    {showContentPreview ? (
                        <div
                            className={cx(
                                "relative mt-3 overflow-hidden rounded-2xl border border-gray-100 bg-gray-50/80 px-3 py-3 dark:border-slate-700 dark:bg-slate-900/60",
                                clipped && "max-h-36"
                            )}
                        >
                            <AnnouncementBlocksView
                                blocks={contentBlocks}
                                className="space-y-2 text-sm leading-5"
                            />
                            {clipped ? (
                                <div className="pointer-events-none absolute inset-x-0 bottom-0 h-12 bg-gradient-to-t from-white via-white/90 to-transparent dark:from-slate-800 dark:via-slate-800/90" />
                            ) : null}
                        </div>
                    ) : null}
                </div>

                <span className="inline-flex shrink-0 items-center gap-1 rounded-full bg-gray-100 px-3 py-1 text-[11px] font-semibold text-gray-500 dark:bg-slate-700 dark:text-slate-300">
                    <Clock3 size={12} />
                    {new Date(createdAt).toLocaleDateString(toIntlLocale(locale), {
                        year: "numeric",
                        month: "short",
                        day: "numeric",
                    })}
                </span>
            </div>
        </div>
    );
}
