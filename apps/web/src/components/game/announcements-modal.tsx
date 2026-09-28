"use client";

import { useEffect, useMemo, useState } from "react";
import Image from "next/image";
import {
    ChevronDown,
    Megaphone,
    Rocket,
    X,
} from "lucide-react";
import type { AnnouncementBlocks } from "@/lib/announcements/content";
import { AnnouncementBlocksView } from "@/components/game/announcement-blocks-view";
import { AnnouncementPreviewCard } from "@/components/game/announcement-preview-card";
import { useI18n } from "@/components/providers/i18n-provider";

interface Announcement {
    id: number;
    title: string;
    contentBlocks: AnnouncementBlocks;
    preview: string;
    type: "guncelleme" | "duyuru" | "sss";
    created_at: string;
    isPinned: boolean;
    version?: string | null;
    tags?: string | null;
    mediaUrl?: string | null;
    mediaType?: "image" | "youtube" | null;
    isNew?: boolean;
}

interface AnnouncementsModalProps {
    isOpen: boolean;
    onClose: () => void;
}

export function AnnouncementsModal({ isOpen, onClose }: AnnouncementsModalProps) {
    const { locale, t } = useI18n();
    const [announcements, setAnnouncements] = useState<Announcement[]>([]);
    const [expandedId, setExpandedId] = useState<number | null>(null);
    const [loadedLocale, setLoadedLocale] = useState<string | null>(null);
    const [activeTab, setActiveTab] = useState<"updates" | "announcements" | "faq">("updates");

    useEffect(() => {
        if (!isOpen) {
            return;
        }

        const controller = new AbortController();
        const recentThreshold = Date.now() - 7 * 24 * 60 * 60 * 1000;

        fetch(`/api/announcements/visible?locale=${locale}`, {
            cache: "no-store",
            signal: controller.signal,
        })
            .then(async (response) => {
                if (!response.ok) {
                    throw new Error("request_failed");
                }
                return response.json();
            })
            .then((data: Announcement[]) => {
                setAnnouncements(
                    data.map((item) => ({
                        ...item,
                        isNew: new Date(item.created_at).getTime() > recentThreshold,
                    }))
                );
            })
            .catch((error: unknown) => {
                if (!(error instanceof DOMException && error.name === "AbortError")) {
                    setAnnouncements([]);
                }
            })
            .finally(() => {
                if (!controller.signal.aborted) {
                    setLoadedLocale(locale);
                }
            });
        return () => controller.abort();
    }, [isOpen, locale]);

    const updates = useMemo(
        () => announcements.filter((announcement) => announcement.type === "guncelleme"),
        [announcements]
    );
    const notices = useMemo(
        () => announcements.filter((announcement) => announcement.type === "duyuru"),
        [announcements]
    );
    const faq = useMemo(
        () => announcements.filter((announcement) => announcement.type === "sss"),
        [announcements]
    );
    const activeItems = activeTab === "updates" ? updates : activeTab === "announcements" ? notices : faq;
    const loading = loadedLocale !== locale;

    if (!isOpen) {
        return null;
    }

    return (
        <div className="fixed inset-0 z-[60] flex items-center justify-center bg-slate-900/55 p-3 backdrop-blur-md transition-colors dark:bg-black/80">
            <div data-testid="announcements-panel" className="flex h-[85vh] w-full max-w-3xl flex-col overflow-hidden rounded-[2rem] border border-slate-200 bg-white text-slate-900 shadow-2xl transition-colors dark:border-slate-700 dark:bg-slate-950 dark:text-slate-100">
                <div className="flex items-center justify-between border-b border-gray-100 p-5 dark:border-slate-800">
                    <div>
                        <h2 className="flex items-center gap-2 text-xl font-black text-slate-800 dark:text-white">
                            {activeTab === "updates" ? (
                                <Rocket size={18} className="text-blue-500" />
                            ) : (
                                <Megaphone size={18} className="text-orange-500" />
                            )}
                            {activeTab === "updates"
                                ? t("announcements.titleUpdates")
                                : activeTab === "announcements"
                                  ? t("announcements.titleNotices")
                                  : t("announcements.titleFaq")}
                        </h2>
                        <p className="mt-1 text-sm text-gray-500 dark:text-gray-400">
                            {t("announcements.subtitle")}
                        </p>
                    </div>
                    <button
                        onClick={onClose}
                        className="rounded-full p-2 text-gray-400 transition-colors hover:bg-gray-100 dark:hover:bg-slate-800"
                        aria-label={t("common.close")}
                        title={t("common.close")}
                    >
                        <X size={20} />
                    </button>
                </div>

                <div className="flex gap-3 border-b border-gray-100 bg-gray-50/60 px-5 py-4 dark:border-slate-800 dark:bg-slate-900/50">
                    <button
                        onClick={() => {
                            setActiveTab("updates");
                            setExpandedId(null);
                        }}
                        className={`flex-1 rounded-xl py-2.5 text-sm font-bold transition-all ${
                            activeTab === "updates"
                                ? "bg-blue-600 text-white shadow-md shadow-blue-500/20"
                                : "border border-gray-200 bg-white text-gray-500 hover:border-gray-300 dark:border-slate-700 dark:bg-slate-800 dark:text-gray-300"
                        }`}
                    >
                        {t("announcements.updates")}
                    </button>
                    <button
                        onClick={() => {
                            setActiveTab("announcements");
                            setExpandedId(null);
                        }}
                        className={`flex-1 rounded-xl py-2.5 text-sm font-bold transition-all ${
                            activeTab === "announcements"
                                ? "bg-orange-600 text-white shadow-md shadow-orange-500/20"
                                : "border border-gray-200 bg-white text-gray-500 hover:border-gray-300 dark:border-slate-700 dark:bg-slate-800 dark:text-gray-300"
                        }`}
                    >
                        {t("announcements.notices")}
                    </button>
                    <button
                        onClick={() => {
                            setActiveTab("faq");
                            setExpandedId(null);
                        }}
                        className={`flex-1 rounded-xl py-2.5 text-sm font-bold transition-all ${
                            activeTab === "faq"
                                ? "bg-emerald-600 text-white shadow-md shadow-emerald-500/20"
                                : "border border-gray-200 bg-white text-gray-500 hover:border-gray-300 dark:border-slate-700 dark:bg-slate-800 dark:text-gray-300"
                        }`}
                    >
                        {t("announcements.faq")}
                    </button>
                </div>

                <div className="flex-1 overflow-y-auto bg-slate-50/80 p-4 transition-colors dark:bg-slate-950">
                    {loading ? (
                        <div className="flex items-center justify-center py-16">
                            <div className="h-8 w-8 animate-spin rounded-full border-2 border-blue-500 border-t-transparent" />
                        </div>
                    ) : activeItems.length === 0 ? (
                        <div className="flex flex-col items-center justify-center py-20 text-center text-gray-400 dark:text-slate-600">
                            {activeTab === "updates" ? <Rocket size={34} /> : <Megaphone size={34} />}
                            <p className="mt-3 text-sm font-medium">{t("announcements.empty")}</p>
                        </div>
                    ) : (
                        <div className="space-y-4">
                            {activeItems.map((item) => {
                                const isExpanded = expandedId === item.id;

                                return (
                                    <div
                                        key={item.id}
                                        className={`overflow-hidden rounded-2xl border transition-all ${
                                            isExpanded
                                                ? "border-blue-200 bg-white shadow-lg ring-1 ring-blue-500/10 dark:border-blue-900/50 dark:bg-slate-800"
                                                : "border-gray-200 bg-white hover:border-blue-300 hover:shadow-md dark:border-slate-700 dark:bg-slate-800"
                                        }`}
                                    >
                                        <button
                                            type="button"
                                            onClick={() => setExpandedId(isExpanded ? null : item.id)}
                                            className="w-full p-4 text-left"
                                        >
                                            <div className="relative pr-8">
                                                <AnnouncementPreviewCard
                                                    title={item.title}
                                                    contentBlocks={item.contentBlocks}
                                                    createdAt={item.created_at}
                                                    isPinned={item.isPinned}
                                                    isNew={item.isNew}
                                                    version={item.version}
                                                    tags={item.tags}
                                                    mediaUrl={item.mediaUrl}
                                                    mediaType={item.mediaType}
                                                    clipped={!isExpanded}
                                                    className="border-0 bg-transparent shadow-none"
                                                />
                                                <ChevronDown
                                                    size={18}
                                                    className={`absolute right-0 top-2 text-gray-400 transition-transform ${
                                                        isExpanded ? "rotate-180" : ""
                                                    }`}
                                                />
                                            </div>
                                        </button>

                                        {isExpanded && (
                                            <div className="border-t border-gray-100 px-4 py-4 dark:border-slate-700">
                                                {item.mediaUrl && (
                                                    <div className="mb-4 overflow-hidden rounded-2xl border border-gray-100 dark:border-slate-700">
                                                        {item.mediaType === "youtube" ? (
                                                            <div className="aspect-video">
                                                                <iframe
                                                                    src={item.mediaUrl}
                                                                    title={item.title}
                                                                    className="h-full w-full"
                                                                    frameBorder="0"
                                                                    loading="lazy"
                                                                    referrerPolicy="strict-origin-when-cross-origin"
                                                                    sandbox="allow-scripts allow-same-origin allow-presentation"
                                                                    allow="accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture"
                                                                    allowFullScreen
                                                                />
                                                            </div>
                                                        ) : (
                                                            <Image
                                                                src={item.mediaUrl}
                                                                alt={item.title}
                                                                width={1200}
                                                                height={675}
                                                                unoptimized
                                                                className="h-auto max-h-[320px] w-full object-cover"
                                                            />
                                                        )}
                                                    </div>
                                                )}

                                                <AnnouncementBlocksView blocks={item.contentBlocks} />
                                            </div>
                                        )}
                                    </div>
                                );
                            })}
                        </div>
                    )}
                </div>
            </div>
        </div>
    );
}



