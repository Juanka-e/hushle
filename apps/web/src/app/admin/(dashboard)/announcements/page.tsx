"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import {
    Bell,
    Eye,
    EyeOff,
    Loader2,
    Megaphone,
    Pencil,
    Pin,
    PinOff,
    Plus,
    Star,
    Tag,
    Trash2,
    X,
} from "lucide-react";
import { toast } from "sonner";
import {
    announcementBlocksSchema,
    createEmptyAnnouncementBlocks,
    type AnnouncementBlocks,
} from "@/lib/announcements/content";
import { AnnouncementBlocksEditor } from "@/components/admin/announcement-blocks-editor";
import { AnnouncementPreviewCard } from "@/components/game/announcement-preview-card";

interface AnnouncementRecord {
    id: number;
    title: string;
    contentBlocks: AnnouncementBlocks;
    contentPreview: string;
    translations: Partial<Record<"tr" | "en", {
        title: string;
        contentBlocks: AnnouncementBlocks;
        contentPreview: string;
    }>>;
    type: "guncelleme" | "duyuru" | "sss";
    isVisible: boolean;
    isPinned: boolean;
    createdAt: string;
    version?: string | null;
    tags?: string | null;
    mediaUrl?: string | null;
    mediaType?: "image" | "youtube" | null;
}

interface AnnouncementFormState {
    translations: Record<"tr" | "en", {
        title: string;
        contentBlocks: AnnouncementBlocks;
    }>;
    type: "guncelleme" | "duyuru" | "sss";
    isVisible: boolean;
    isPinned: boolean;
    version: string;
    tags: string;
    mediaUrl: string;
    mediaType: "image" | "youtube" | null;
}

const defaultFormState: AnnouncementFormState = {
    translations: {
        tr: { title: "", contentBlocks: createEmptyAnnouncementBlocks() },
        en: { title: "", contentBlocks: createEmptyAnnouncementBlocks() },
    },
    type: "guncelleme" as const,
    isVisible: true,
    isPinned: false,
    version: "",
    tags: "",
    mediaUrl: "",
    mediaType: null as "image" | "youtube" | null,
};

export default function AdminAnnouncementsPage() {
    const [announcements, setAnnouncements] = useState<AnnouncementRecord[]>([]);
    const [loading, setLoading] = useState(true);
    const [formOpen, setFormOpen] = useState(false);
    const [editing, setEditing] = useState<AnnouncementRecord | null>(null);
    const [formState, setFormState] = useState<AnnouncementFormState>(defaultFormState);
    const [formSaving, setFormSaving] = useState(false);
    const [formError, setFormError] = useState("");
    const [editingLocale, setEditingLocale] = useState<"tr" | "en">("tr");
    const [englishEnabled, setEnglishEnabled] = useState(false);
    const [deleting, setDeleting] = useState<number | null>(null);
    const [togglingPin, setTogglingPin] = useState<number | null>(null);

    const fetchAnnouncements = useCallback(async () => {
        setLoading(true);
        try {
            const response = await fetch("/api/admin/announcements", {
                cache: "no-store",
            });
            const data = (await response.json()) as AnnouncementRecord[];
            setAnnouncements(data);
        } catch {
            toast.error("Duyurular yuklenemedi.");
        } finally {
            setLoading(false);
        }
    }, []);

    useEffect(() => {
        fetchAnnouncements();
    }, [fetchAnnouncements]);

    const sortedAnnouncements = useMemo(
        () =>
            [...announcements].sort((left, right) => {
                if (left.isPinned !== right.isPinned) {
                    return left.isPinned ? -1 : 1;
                }
                return new Date(right.createdAt).getTime() - new Date(left.createdAt).getTime();
            }),
        [announcements]
    );

    const openCreate = () => {
        setEditing(null);
        setFormState(defaultFormState);
        setFormError("");
        setEditingLocale("tr");
        setEnglishEnabled(false);
        setFormOpen(true);
    };

    const openEdit = (announcement: AnnouncementRecord) => {
        const turkish = announcement.translations.tr ?? {
            title: announcement.title,
            contentBlocks: announcement.contentBlocks,
        };
        const english = announcement.translations.en;
        setEditing(announcement);
        setFormState({
            translations: {
                tr: { title: turkish.title, contentBlocks: turkish.contentBlocks },
                en: {
                    title: english?.title ?? "",
                    contentBlocks: english?.contentBlocks ?? createEmptyAnnouncementBlocks(),
                },
            },
            type: announcement.type,
            isVisible: announcement.isVisible,
            isPinned: announcement.isPinned,
            version: announcement.version ?? "",
            tags: announcement.tags ?? "",
            mediaUrl: announcement.mediaUrl ?? "",
            mediaType: announcement.mediaType ?? null,
        });
        setEditingLocale("tr");
        setEnglishEnabled(Boolean(english));
        setFormError("");
        setFormOpen(true);
    };

    const handleSave = async () => {
        if (!formState.translations.tr.title.trim()) {
            setFormError("Türkçe başlık boş olamaz.");
            return;
        }

        const parsedTurkishBlocks = announcementBlocksSchema.safeParse(
            formState.translations.tr.contentBlocks
        );
        if (!parsedTurkishBlocks.success) {
            setFormError(parsedTurkishBlocks.error.issues[0]?.message ?? "Türkçe içerik blokları geçersiz.");
            return;
        }
        const parsedEnglishBlocks = englishEnabled
            ? announcementBlocksSchema.safeParse(formState.translations.en.contentBlocks)
            : null;
        if (englishEnabled && !formState.translations.en.title.trim()) {
            setFormError("İngilizce içerik etkinse İngilizce başlık zorunludur.");
            return;
        }
        if (parsedEnglishBlocks && !parsedEnglishBlocks.success) {
            setFormError(parsedEnglishBlocks.error.issues[0]?.message ?? "İngilizce içerik blokları geçersiz.");
            return;
        }

        setFormSaving(true);
        setFormError("");

        try {
            const response = await fetch(
                editing ? `/api/admin/announcements/${editing.id}` : "/api/admin/announcements",
                {
                    method: editing ? "PUT" : "POST",
                    headers: { "Content-Type": "application/json" },
                    body: JSON.stringify({
                        translations: {
                            tr: {
                                title: formState.translations.tr.title.trim(),
                                contentBlocks: parsedTurkishBlocks.data,
                            },
                            en: englishEnabled && parsedEnglishBlocks?.success
                                ? {
                                      title: formState.translations.en.title.trim(),
                                      contentBlocks: parsedEnglishBlocks.data,
                                  }
                                : null,
                        },
                        type: formState.type,
                        isVisible: formState.isVisible,
                        isPinned: formState.isPinned,
                        version: formState.version.trim() || null,
                        tags: formState.tags.trim() || null,
                        mediaUrl: formState.mediaUrl.trim() || null,
                        mediaType: formState.mediaType,
                    }),
                }
            );

            if (!response.ok) {
                const errorPayload = await response.json().catch(() => null);
                setFormError(errorPayload?.error ?? "Duyuru kaydedilemedi.");
                return;
            }

            toast.success(editing ? "Duyuru guncellendi." : "Duyuru olusturuldu.");
            setFormOpen(false);
            setFormState(defaultFormState);
            await fetchAnnouncements();
        } catch {
            setFormError("Ag hatasi olustu.");
        } finally {
            setFormSaving(false);
        }
    };

    const handleDelete = async (id: number) => {
        if (!window.confirm("Bu duyuru silinsin mi?")) {
            return;
        }

        setDeleting(id);
        try {
            const response = await fetch(`/api/admin/announcements/${id}`, {
                method: "DELETE",
            });

            if (!response.ok) {
                toast.error("Duyuru silinemedi.");
                return;
            }

            toast.success("Duyuru silindi.");
            await fetchAnnouncements();
        } finally {
            setDeleting(null);
        }
    };

    const toggleVisibility = async (announcement: AnnouncementRecord) => {
        const response = await fetch(`/api/admin/announcements/${announcement.id}`, {
            method: "PUT",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ isVisible: !announcement.isVisible }),
        });

        if (!response.ok) {
            toast.error("Gorunurluk guncellenemedi.");
            return;
        }

        await fetchAnnouncements();
    };

    const togglePin = async (announcement: AnnouncementRecord) => {
        setTogglingPin(announcement.id);
        try {
            const response = await fetch(`/api/admin/announcements/${announcement.id}`, {
                method: "PUT",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({ isPinned: !announcement.isPinned }),
            });

            if (!response.ok) {
                toast.error("Sabit durumu guncellenemedi.");
                return;
            }

            await fetchAnnouncements();
        } finally {
            setTogglingPin(null);
        }
    };

    const activeTranslation = formState.translations[editingLocale];
    const updateActiveTranslation = (
        patch: Partial<(typeof formState.translations)["tr"]>
    ) => {
        setFormState((current) => ({
            ...current,
            translations: {
                ...current.translations,
                [editingLocale]: {
                    ...current.translations[editingLocale],
                    ...patch,
                },
            },
        }));
    };

    return (
        <div className="space-y-6">
            <div className="flex items-center justify-between gap-4">
                <div>
                    <h1 className="flex items-center gap-2 text-2xl font-bold text-foreground">
                        <Megaphone className="h-6 w-6 text-blue-500" />
                        Duyuru Yonetimi
                    </h1>
                    <p className="mt-1 text-sm text-muted-foreground">
                        Toplam {announcements.length} duyuru.
                    </p>
                </div>
                <button
                    onClick={openCreate}
                    className="inline-flex items-center gap-2 rounded-xl bg-blue-600 px-4 py-2.5 text-sm font-semibold text-white shadow-sm transition-colors hover:bg-blue-700"
                >
                    <Plus size={18} />
                    Yeni Duyuru
                </button>
            </div>

            <div className="overflow-hidden rounded-2xl border border-gray-100 bg-white shadow-sm dark:border-slate-700 dark:bg-slate-800">
                {loading ? (
                    <div className="flex items-center justify-center py-16">
                        <Loader2 size={24} className="animate-spin text-blue-500" />
                    </div>
                ) : sortedAnnouncements.length === 0 ? (
                    <div className="py-16 text-center text-gray-400 dark:text-slate-500">
                        <Megaphone size={32} className="mx-auto mb-3 opacity-40" />
                        Henuz duyuru yok.
                    </div>
                ) : (
                    <div className="divide-y divide-gray-100 dark:divide-slate-700">
                        {sortedAnnouncements.map((announcement) => {
                            const isNew =
                                new Date(announcement.createdAt) >
                                new Date(Date.now() - 7 * 24 * 60 * 60 * 1000);
                            const tags = announcement.tags
                                ? announcement.tags.split(",").map((tag) => tag.trim()).filter(Boolean)
                                : [];
                            return (
                                <div
                                    key={announcement.id}
                                    className={`flex items-start gap-4 px-5 py-4 ${!announcement.isVisible ? "opacity-60" : ""}`}
                                >
                                    <div className="mt-1">
                                        {announcement.type === "guncelleme" ? (
                                            <Bell size={20} className="text-blue-500" />
                                        ) : (
                                            <Megaphone size={20} className="text-amber-500" />
                                        )}
                                    </div>

                                    <div className="min-w-0 flex-1">
                                        <div className="mb-2 flex flex-wrap items-center gap-2">
                                            {announcement.isPinned && (
                                                <span className="inline-flex items-center gap-1 rounded-full bg-amber-100 px-2 py-1 text-[10px] font-black text-amber-700 dark:bg-amber-900/30 dark:text-amber-300">
                                                    <Pin size={11} fill="currentColor" />
                                                    SABIT
                                                </span>
                                            )}
                                            {isNew && (
                                                <span className="inline-flex items-center gap-1 rounded-full bg-blue-100 px-2 py-1 text-[10px] font-black text-blue-700 dark:bg-blue-900/30 dark:text-blue-300">
                                                    <Star size={11} fill="currentColor" />
                                                    YENI
                                                </span>
                                            )}
                                            <h3 className="text-sm font-bold text-slate-900 dark:text-white">
                                                {announcement.translations.tr?.title ?? announcement.title}
                                            </h3>
                                            {announcement.version && (
                                                <span className="rounded bg-gray-100 px-2 py-1 font-mono text-[10px] text-gray-600 dark:bg-slate-700 dark:text-slate-300">
                                                    {announcement.version}
                                                </span>
                                            )}
                                            {tags.map((tag) => (
                                                <span
                                                    key={tag}
                                                    className="inline-flex items-center gap-1 rounded bg-gray-100 px-2 py-1 text-[10px] font-semibold uppercase tracking-wide text-gray-500 dark:bg-slate-700 dark:text-slate-300"
                                                >
                                                    <Tag size={10} />
                                                    {tag}
                                                </span>
                                            ))}
                                        </div>

                                        <div className="mt-2 flex flex-wrap items-center gap-3 text-xs text-gray-400 dark:text-slate-500">
                                            <span>
                                                {new Date(announcement.createdAt).toLocaleDateString("tr-TR", {
                                                    year: "numeric",
                                                    month: "long",
                                                    day: "numeric",
                                                })}
                                            </span>
                                            {announcement.mediaUrl && (
                                                <span>{announcement.mediaType === "youtube" ? "Video" : "Gorsel"}</span>
                                            )}
                                        </div>
                                    </div>

                                    <div className="flex items-center gap-1">
                                        <button
                                            onClick={() => togglePin(announcement)}
                                            disabled={togglingPin === announcement.id}
                                            className={`rounded-lg p-2 transition-colors ${
                                                announcement.isPinned
                                                    ? "bg-amber-50 text-amber-600 dark:bg-amber-900/20 dark:text-amber-300"
                                                    : "text-gray-500 hover:bg-gray-100 hover:text-amber-600 dark:text-slate-400 dark:hover:bg-slate-700 dark:hover:text-amber-300"
                                            }`}
                                            title={announcement.isPinned ? "Sabiti kaldir" : "Sabitle"}
                                        >
                                            {togglingPin === announcement.id ? (
                                                <Loader2 size={15} className="animate-spin" />
                                            ) : announcement.isPinned ? (
                                                <PinOff size={15} />
                                            ) : (
                                                <Pin size={15} />
                                            )}
                                        </button>
                                        <button
                                            onClick={() => toggleVisibility(announcement)}
                                            className="rounded-lg p-2 text-gray-500 transition-colors hover:bg-gray-100 hover:text-purple-600 dark:text-slate-400 dark:hover:bg-slate-700 dark:hover:text-purple-300"
                                            title={announcement.isVisible ? "Gizle" : "Gorunur yap"}
                                        >
                                            {announcement.isVisible ? <Eye size={15} /> : <EyeOff size={15} />}
                                        </button>
                                        <button
                                            onClick={() => openEdit(announcement)}
                                            className="rounded-lg p-2 text-gray-500 transition-colors hover:bg-gray-100 hover:text-blue-600 dark:text-slate-400 dark:hover:bg-slate-700 dark:hover:text-blue-300"
                                            title="Duzenle"
                                        >
                                            <Pencil size={15} />
                                        </button>
                                        <button
                                            onClick={() => handleDelete(announcement.id)}
                                            disabled={deleting === announcement.id}
                                            className="rounded-lg p-2 text-gray-500 transition-colors hover:bg-red-50 hover:text-red-600 disabled:opacity-50 dark:text-slate-400 dark:hover:bg-red-950/40 dark:hover:text-red-300"
                                            title="Sil"
                                        >
                                            {deleting === announcement.id ? (
                                                <Loader2 size={15} className="animate-spin" />
                                            ) : (
                                                <Trash2 size={15} />
                                            )}
                                        </button>
                                    </div>
                                </div>
                            );
                        })}
                    </div>
                )}
            </div>

            {formOpen && (
                <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4 backdrop-blur-sm">
                    <div className="flex max-h-[92vh] w-full max-w-5xl flex-col overflow-hidden rounded-2xl border border-gray-100 bg-white shadow-2xl dark:border-slate-700 dark:bg-slate-800">
                        <div className="flex items-center justify-between border-b border-gray-100 bg-white p-5 dark:border-slate-700 dark:bg-slate-800">
                            <div>
                                <h2 className="text-lg font-bold text-slate-900 dark:text-white">
                                    {editing ? "Duyuruyu Duzenle" : "Yeni Duyuru"}
                                </h2>
                                <p className="text-sm text-muted-foreground">
                                    Kisa ve okunur bir icerik akisiyla kaydedilir.
                                </p>
                            </div>
                            <button
                                onClick={() => setFormOpen(false)}
                                className="rounded-full p-2 text-gray-500 transition-colors hover:bg-gray-100 dark:text-slate-400 dark:hover:bg-slate-700"
                            >
                                <X size={20} />
                            </button>
                        </div>

                        <div className="grid gap-0 overflow-y-auto lg:grid-cols-[1.15fr_0.85fr]">
                            <div className="space-y-5 border-b border-gray-100 p-5 dark:border-slate-700 lg:border-b-0 lg:border-r">
                                {formError && (
                                    <div className="rounded-xl bg-red-50 px-4 py-3 text-sm font-medium text-red-600 dark:bg-red-950/30 dark:text-red-300">
                                        {formError}
                                    </div>
                                )}

                                <div className="rounded-2xl border border-gray-200 bg-gray-50 p-3 dark:border-slate-700 dark:bg-slate-900/60">
                                    <div className="flex flex-wrap items-center justify-between gap-3">
                                        <div className="flex gap-2" role="tablist" aria-label="Duyuru dili">
                                            <button
                                                type="button"
                                                role="tab"
                                                aria-selected={editingLocale === "tr"}
                                                onClick={() => setEditingLocale("tr")}
                                                className={`rounded-xl px-4 py-2 text-sm font-bold ${editingLocale === "tr" ? "bg-blue-600 text-white" : "bg-white text-slate-600 dark:bg-slate-800 dark:text-slate-300"}`}
                                            >
                                                Türkçe <span className="ml-1 text-[10px] opacity-75">ZORUNLU</span>
                                            </button>
                                            <button
                                                type="button"
                                                role="tab"
                                                aria-selected={editingLocale === "en"}
                                                disabled={!englishEnabled}
                                                onClick={() => setEditingLocale("en")}
                                                className={`rounded-xl px-4 py-2 text-sm font-bold disabled:cursor-not-allowed disabled:opacity-40 ${editingLocale === "en" ? "bg-blue-600 text-white" : "bg-white text-slate-600 dark:bg-slate-800 dark:text-slate-300"}`}
                                            >
                                                English
                                            </button>
                                        </div>
                                        <label className="inline-flex items-center gap-2 text-sm font-semibold text-slate-600 dark:text-slate-300">
                                            <input
                                                type="checkbox"
                                                checked={englishEnabled}
                                                onChange={(event) => {
                                                    setEnglishEnabled(event.target.checked);
                                                    if (!event.target.checked) setEditingLocale("tr");
                                                }}
                                            />
                                            İngilizce çeviri ekle
                                        </label>
                                    </div>
                                    <p className="mt-2 text-xs text-muted-foreground">
                                        İngilizce çeviri yoksa oyuncuya güvenli biçimde Türkçe içerik gösterilir.
                                    </p>
                                </div>

                                <div className="grid gap-4 md:grid-cols-2">
                                    <div className="md:col-span-2">
                                        <label className="mb-1.5 block text-sm font-semibold text-slate-700 dark:text-slate-200">
                                            {editingLocale === "tr" ? "Türkçe başlık" : "English title"}
                                        </label>
                                        <input
                                            type="text"
                                            value={activeTranslation.title}
                                            onChange={(event) => updateActiveTranslation({ title: event.target.value })}
                                            className="w-full rounded-xl border border-gray-200 bg-white px-4 py-2.5 text-sm outline-none focus:ring-2 focus:ring-blue-500 dark:border-slate-700 dark:bg-slate-950"
                                        />
                                    </div>
                                    <div>
                                        <label className="mb-1.5 block text-sm font-semibold text-slate-700 dark:text-slate-200">
                                            Tip
                                        </label>
                                        <select
                                            value={formState.type}
                                            onChange={(event) =>
                                                setFormState((current) => ({
                                                    ...current,
                                                    type: event.target.value as "guncelleme" | "duyuru" | "sss",
                                                }))
                                            }
                                            className="w-full rounded-xl border border-gray-200 bg-white px-4 py-2.5 text-sm outline-none focus:ring-2 focus:ring-blue-500 dark:border-slate-700 dark:bg-slate-950"
                                        >
                                            <option value="guncelleme">Guncelleme</option>
                                            <option value="duyuru">Duyuru</option>
                                            <option value="sss">S.S.S.</option>
                                        </select>
                                    </div>
                                    <div>
                                        <label className="mb-1.5 block text-sm font-semibold text-slate-700 dark:text-slate-200">
                                            Versiyon
                                        </label>
                                        <input
                                            type="text"
                                            value={formState.version}
                                            onChange={(event) =>
                                                setFormState((current) => ({ ...current, version: event.target.value }))
                                            }
                                            className="w-full rounded-xl border border-gray-200 bg-white px-4 py-2.5 text-sm outline-none focus:ring-2 focus:ring-blue-500 dark:border-slate-700 dark:bg-slate-950"
                                        />
                                    </div>
                                    <div className="md:col-span-2">
                                        <label className="mb-1.5 block text-sm font-semibold text-slate-700 dark:text-slate-200">
                                            Etiketler
                                        </label>
                                        <input
                                            type="text"
                                            value={formState.tags}
                                            onChange={(event) =>
                                                setFormState((current) => ({ ...current, tags: event.target.value }))
                                            }
                                            className="w-full rounded-xl border border-gray-200 bg-white px-4 py-2.5 text-sm outline-none focus:ring-2 focus:ring-blue-500 dark:border-slate-700 dark:bg-slate-950"
                                        />
                                    </div>
                                    <div>
                                        <label className="mb-1.5 block text-sm font-semibold text-slate-700 dark:text-slate-200">
                                            Medya Turu
                                        </label>
                                        <select
                                            value={formState.mediaType ?? ""}
                                            onChange={(event) =>
                                                setFormState((current) => ({
                                                    ...current,
                                                    mediaType: (event.target.value || null) as "image" | "youtube" | null,
                                                    mediaUrl: event.target.value ? current.mediaUrl : "",
                                                }))
                                            }
                                            className="w-full rounded-xl border border-gray-200 bg-white px-4 py-2.5 text-sm outline-none focus:ring-2 focus:ring-blue-500 dark:border-slate-700 dark:bg-slate-950"
                                        >
                                            <option value="">Yok</option>
                                            <option value="image">Gorsel</option>
                                            <option value="youtube">YouTube</option>
                                        </select>
                                    </div>
                                    <div>
                                        <label className="mb-1.5 block text-sm font-semibold text-slate-700 dark:text-slate-200">
                                            Medya URL
                                        </label>
                                        <input
                                            type="text"
                                            value={formState.mediaUrl}
                                            disabled={!formState.mediaType}
                                            onChange={(event) =>
                                                setFormState((current) => ({ ...current, mediaUrl: event.target.value }))
                                            }
                                            className="w-full rounded-xl border border-gray-200 bg-white px-4 py-2.5 text-sm outline-none focus:ring-2 focus:ring-blue-500 disabled:cursor-not-allowed disabled:opacity-50 dark:border-slate-700 dark:bg-slate-950"
                                        />
                                    </div>
                                </div>

                                <div className="flex flex-wrap gap-5">
                                    <label className="inline-flex items-center gap-3 text-sm text-slate-700 dark:text-slate-200">
                                        <input
                                            type="checkbox"
                                            checked={formState.isVisible}
                                            onChange={(event) =>
                                                setFormState((current) => ({ ...current, isVisible: event.target.checked }))
                                            }
                                            className="rounded border-gray-300 text-blue-600 focus:ring-blue-500"
                                        />
                                        Oyunculara gorunur
                                    </label>
                                    <label className="inline-flex items-center gap-3 text-sm text-slate-700 dark:text-slate-200">
                                        <input
                                            type="checkbox"
                                            checked={formState.isPinned}
                                            onChange={(event) =>
                                                setFormState((current) => ({ ...current, isPinned: event.target.checked }))
                                            }
                                            className="rounded border-gray-300 text-amber-500 focus:ring-amber-500"
                                        />
                                        Sabit tut
                                    </label>
                                </div>

                                <div>
                                    <label className="mb-2 block text-sm font-semibold text-slate-700 dark:text-slate-200">
                                        {editingLocale === "tr" ? "Türkçe içerik blokları" : "English content blocks"}
                                    </label>
                                    <AnnouncementBlocksEditor
                                        value={activeTranslation.contentBlocks}
                                        onChange={(contentBlocks) => updateActiveTranslation({ contentBlocks })}
                                    />
                                </div>
                            </div>

                            <div className="space-y-4 p-5">
                                <div>
                                    <h3 className="text-sm font-semibold uppercase tracking-wide text-gray-500 dark:text-slate-400">
                                        Oyuncu görünümü
                                    </h3>
                                    <div className="mt-3 rounded-2xl border border-gray-100 bg-white p-4 dark:border-slate-700 dark:bg-slate-900/70">
                                        <AnnouncementPreviewCard
                                            title={activeTranslation.title.trim() || (editingLocale === "tr" ? "Duyuru başlığı" : "Announcement title")}
                                            contentBlocks={activeTranslation.contentBlocks}
                                            createdAt={editing?.createdAt ?? new Date().toISOString()}
                                            isPinned={formState.isPinned}
                                            isNew={!editing}
                                            version={formState.version.trim() || null}
                                            tags={formState.tags.trim() || null}
                                            mediaUrl={formState.mediaUrl.trim() || null}
                                            mediaType={formState.mediaType}
                                            showContentPreview={false}
                                            clipped
                                        />
                                    </div>
                                </div>

                                <div className="rounded-2xl border border-gray-100 bg-gray-50 p-4 dark:border-slate-700 dark:bg-slate-900/60">
                                    <h3 className="text-sm font-semibold text-slate-800 dark:text-white">
                                        Editör notu
                                    </h3>
                                    <ul className="mt-3 list-disc space-y-2 pl-5 text-sm text-slate-600 dark:text-slate-300">
                                        <li>Sağdaki kart oyuncunun listede göreceği görünümü taklit eder.</li>
                                        <li>Detaya girildiğinde aynı içerik blokları tam açılır.</li>
                                        <li>Eski HTML duyurular legacy uyumlulukla okunur.</li>
                                    </ul>
                                </div>
                            </div>
                        </div>

                        <div className="flex justify-end gap-3 border-t border-gray-100 p-5 dark:border-slate-700">
                            <button
                                onClick={() => setFormOpen(false)}
                                className="rounded-xl px-4 py-2.5 text-sm font-semibold text-gray-500 transition-colors hover:bg-gray-100 dark:text-slate-300 dark:hover:bg-slate-700"
                            >
                                Iptal
                            </button>
                            <button
                                onClick={handleSave}
                                disabled={formSaving}
                                className="inline-flex items-center gap-2 rounded-xl bg-blue-600 px-5 py-2.5 text-sm font-semibold text-white transition-colors hover:bg-blue-700 disabled:opacity-50"
                            >
                                {formSaving && <Loader2 size={16} className="animate-spin" />}
                                {editing ? "Guncelle" : "Kaydet"}
                            </button>
                        </div>
                    </div>
                </div>
            )}
        </div>
    );
}



