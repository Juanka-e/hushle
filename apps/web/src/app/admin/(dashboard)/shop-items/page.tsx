"use client";

import { useCallback, useEffect, useMemo, useState, type ChangeEvent } from "react";
import Image, { type ImageLoaderProps } from "next/image";
import Link from "next/link";
import { toast } from "sonner";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { CosmeticLivePreview } from "@/components/admin/cosmetic-live-preview";
import { ShopOrderBoard } from "@/components/admin/shop-order-board";
import { AdminPageHeader } from "@/components/admin/admin-page-header";
import { AdminPagination } from "@/components/admin/admin-pagination";
import { AdminSelectionBar } from "@/components/admin/admin-selection-bar";
import { AdminTableShell, AdminEmptyState } from "@/components/admin/admin-table-shell";
import { AdminToolbar, AdminToolbarStats } from "@/components/admin/admin-toolbar";
import { useAdminSelection } from "@/hooks/use-admin-selection";
import { paginateItems } from "@/lib/admin/admin-table";
import {
    Edit2,
    FileJson2,
    Eye,
    EyeOff,
    Image as ImageIcon,
    Plus,
    Save,
    Search,
    Trash2,
    Upload,
    X,
} from "lucide-react";
import type { TemplateConfig } from "@/types/economy";
import {
    ADMIN_RARITY_BADGE_CLASS,
} from "@/lib/store/shop-admin";
import {
    getCosmeticAuthoringPresets,
    serializeCosmeticAuthoringPreset,
} from "@/lib/cosmetics/authoring-presets";
import { CURRENT_COSMETIC_RENDER_SPEC_VERSION } from "@/lib/cosmetics/render-spec-version";

type ItemType = "avatar" | "frame" | "card_back" | "card_face";
type Rarity = "common" | "rare" | "epic" | "legendary";
type RenderMode = "image" | "template";
type ActiveFilter = "all" | "active" | "inactive";
type FeaturedFilter = "all" | "featured" | "standard";
type AvailabilityMode = "always_on" | "scheduled" | "seasonal" | "limited" | "event_only";
type AvailabilityFilter = "all" | AvailabilityMode;

interface ShopItem {
    id: number;
    code: string;
    type: ItemType;
    name: string;
    rarity: Rarity;
    renderMode: RenderMode;
    renderSpecVersion: number;
    priceCoin: number;
    imageUrl: string;
    thumbnailUrl: string | null;
    templateKey: string | null;
    templateConfig: TemplateConfig | null;
    badgeText: string | null;
    availabilityMode: AvailabilityMode;
    startsAt: string | null;
    endsAt: string | null;
    isFeatured: boolean;
    isActive: boolean;
    sortOrder: number;
    createdAt: string;
    _count?: {
        inventoryItems: number;
        purchases: number;
        bundleEntries: number;
        discountCampaigns: number;
        couponCodes: number;
    };
}

interface ShopItemFormState {
    code: string;
    type: ItemType;
    name: string;
    rarity: Rarity;
    renderMode: RenderMode;
    renderSpecVersion: number;
    priceCoin: number;
    imageUrl: string;
    thumbnailUrl: string;
    templateKey: string;
    templateConfigText: string;
    badgeText: string;
    availabilityMode: AvailabilityMode;
    startsAt: string;
    endsAt: string;
    isFeatured: boolean;
    isActive: boolean;
    sortOrder: number;
}

const typeLabels: Record<ItemType, string> = {
    avatar: "Avatar",
    frame: "Çerçeve",
    card_back: "Kart Arkası",
    card_face: "Kart Önü",
};

const rarityLabels: Record<Rarity, string> = {
    common: "Yaygın",
    rare: "Nadir",
    epic: "Epik",
    legendary: "Efsanevi",
};

const availabilityLabels: Record<AvailabilityMode, string> = {
    always_on: "Sürekli",
    scheduled: "Planlı",
    seasonal: "Sezonluk",
    limited: "Sınırlı",
    event_only: "Etkinlik",
};

function StatusPill({
    label,
    tone = "neutral",
}: {
    label: string;
    tone?: "neutral" | "success" | "danger" | "warning" | "accent";
}) {
    const toneClassName =
        tone === "success"
            ? "bg-emerald-100 text-emerald-700 dark:bg-emerald-900/30 dark:text-emerald-300"
            : tone === "danger"
              ? "bg-rose-100 text-rose-700 dark:bg-rose-900/30 dark:text-rose-300"
              : tone === "warning"
                ? "bg-amber-100 text-amber-700 dark:bg-amber-900/30 dark:text-amber-300"
                : tone === "accent"
                  ? "bg-fuchsia-100 text-fuchsia-700 dark:bg-fuchsia-900/30 dark:text-fuchsia-300"
                  : "bg-muted text-muted-foreground";

    return (
        <span className={`inline-flex rounded-full px-2.5 py-1 text-[10px] font-bold uppercase tracking-[0.18em] ${toneClassName}`}>
            {label}
        </span>
    );
}

const emptyItem: ShopItemFormState = {
    code: "",
    type: "avatar",
    name: "",
    rarity: "common",
    renderMode: "image",
    renderSpecVersion: 1,
    priceCoin: 100,
    imageUrl: "",
    thumbnailUrl: "",
    templateKey: "",
    templateConfigText: "",
    badgeText: "",
    availabilityMode: "always_on",
    startsAt: "",
    endsAt: "",
    isFeatured: false,
    isActive: true,
    sortOrder: 0,
};

const passthroughImageLoader = ({ src }: ImageLoaderProps) => src;

function stringifyTemplateConfig(config: TemplateConfig | null): string {
    return config ? JSON.stringify(config, null, 2) : "";
}

function mapUploadCategory(type: ItemType): string {
    if (type === "card_back") {
        return "card-backs";
    }
    if (type === "card_face") {
        return "card-faces";
    }
    return `${type}s`;
}

function parseTemplateConfig(templateConfigText: string): TemplateConfig | null {
    const trimmed = templateConfigText.trim();
    if (!trimmed) {
        return null;
    }

    const parsed = JSON.parse(trimmed) as unknown;
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
        throw new Error("Template config must be a JSON object.");
    }

    const normalized = normalizeTemplateObject(parsed as Record<string, unknown>, 0);
    return Object.keys(normalized).length > 0 ? normalized : null;
}

function normalizeTemplateObject(input: Record<string, unknown>, depth: number): TemplateConfig {
    if (depth > 3) {
        throw new Error("Template config supports up to 3 nested levels.");
    }

    const normalizedEntries: [string, TemplateConfig[keyof TemplateConfig]][] = [];

    for (const [key, value] of Object.entries(input)) {
        if (!key.trim()) {
            continue;
        }

        if (value === null || typeof value === "string" || typeof value === "number" || typeof value === "boolean") {
            normalizedEntries.push([key, value]);
            continue;
        }

        if (Array.isArray(value)) {
            if (!value.every((entry) => entry === null || typeof entry === "string" || typeof entry === "number" || typeof entry === "boolean")) {
                throw new Error("Template config arrays can only contain string, number, boolean or null values.");
            }
            normalizedEntries.push([key, value]);
            continue;
        }

        if (typeof value === "object") {
            const nestedObject = value as Record<string, unknown>;
            normalizedEntries.push([key, normalizeTemplateObject(nestedObject, depth + 1)]);
            continue;
        }

        throw new Error("Unsupported template config value.");
    }

    return Object.fromEntries(normalizedEntries);
}

function toDateTimeLocalInput(value: string | null): string {
    if (!value) {
        return "";
    }

    const date = new Date(value);
    if (Number.isNaN(date.getTime())) {
        return "";
    }

    const year = date.getFullYear();
    const month = String(date.getMonth() + 1).padStart(2, "0");
    const day = String(date.getDate()).padStart(2, "0");
    const hours = String(date.getHours()).padStart(2, "0");
    const minutes = String(date.getMinutes()).padStart(2, "0");

    return `${year}-${month}-${day}T${hours}:${minutes}`;
}

function toIsoDateTime(value: string): string | null {
    if (!value) {
        return null;
    }

    return new Date(value).toISOString();
}

function getAvailabilityTone(mode: AvailabilityMode): "neutral" | "accent" | "warning" {
    if (mode === "scheduled") {
        return "accent";
    }

    if (mode === "limited" || mode === "event_only") {
        return "warning";
    }

    return "neutral";
}

function getAvailabilityWindowState(startsAt: string | null, endsAt: string | null): { label: string; tone: "neutral" | "accent" | "warning" | "success" } {
    const now = Date.now();

    if (startsAt && new Date(startsAt).getTime() > now) {
        return { label: "Planlı", tone: "accent" };
    }

    if (endsAt && new Date(endsAt).getTime() < now) {
        return { label: "Süresi doldu", tone: "warning" };
    }

    return { label: "Yayında", tone: "success" };
}

function buildPromotionsHref(itemCode: string, section: "bundles" | "discounts" | "coupons") {
    return `/admin/promotions?q=${encodeURIComponent(itemCode)}#${section}`;
}

export default function ShopItemsPage() {
    const [items, setItems] = useState<ShopItem[]>([]);
    const [loading, setLoading] = useState(true);
    const [search, setSearch] = useState("");
    const [filterType, setFilterType] = useState<ItemType | "">("");
    const [filterRarity, setFilterRarity] = useState<Rarity | "">("");
    const [filterActive, setFilterActive] = useState<ActiveFilter>("all");
    const [filterFeatured, setFilterFeatured] = useState<FeaturedFilter>("all");
    const [filterAvailability, setFilterAvailability] = useState<AvailabilityFilter>("all");
    const [page, setPage] = useState(1);
    const [showModal, setShowModal] = useState(false);
    const [editingItem, setEditingItem] = useState<ShopItem | null>(null);
    const [form, setForm] = useState<ShopItemFormState>(emptyItem);
    const [saving, setSaving] = useState(false);
    const [reorderSaving, setReorderSaving] = useState(false);
    const [bulkSaving, setBulkSaving] = useState(false);
    const [uploading, setUploading] = useState(false);

    const loadItems = useCallback(async () => {
        setLoading(true);
        try {
            const response = await fetch("/api/admin/shop-items", { cache: "no-store" });
            if (!response.ok) {
                return;
            }

            const payload = (await response.json()) as ShopItem[];
            setItems(payload);
        } catch {
            // Keep previous list on failure.
        } finally {
            setLoading(false);
        }
    }, []);

    useEffect(() => {
        void loadItems();
    }, [loadItems]);

    const filteredItems = useMemo(() => {
        return items.filter((item) => {
            if (filterType && item.type !== filterType) {
                return false;
            }
            if (filterRarity && item.rarity !== filterRarity) {
                return false;
            }
            if (filterActive === "active" && !item.isActive) {
                return false;
            }
            if (filterActive === "inactive" && item.isActive) {
                return false;
            }
            if (filterFeatured === "featured" && !item.isFeatured) {
                return false;
            }
            if (filterFeatured === "standard" && item.isFeatured) {
                return false;
            }
            if (filterAvailability !== "all" && item.availabilityMode !== filterAvailability) {
                return false;
            }
            if (
                search &&
                !item.name.toLowerCase().includes(search.toLowerCase()) &&
                !item.code.toLowerCase().includes(search.toLowerCase()) &&
                !(item.badgeText ?? "").toLowerCase().includes(search.toLowerCase())
            ) {
                return false;
            }
            return true;
        });
    }, [filterActive, filterAvailability, filterFeatured, filterRarity, filterType, items, search]);

    const activeCount = useMemo(() => items.filter((item) => item.isActive).length, [items]);
    const featuredCount = useMemo(() => items.filter((item) => item.isFeatured).length, [items]);
    const timedCount = useMemo(() => items.filter((item) => item.availabilityMode !== "always_on").length, [items]);

    const paginatedItems = useMemo(
        () => paginateItems(filteredItems, page, 12),
        [filteredItems, page]
    );
    const visibleItemIds = useMemo(
        () => paginatedItems.items.map((item) => item.id),
        [paginatedItems.items]
    );
    const {
        allSelected,
        clearSelection,
        selectedCount,
        selectedIds,
        toggleAll,
        toggleOne,
    } = useAdminSelection(visibleItemIds);

    useEffect(() => {
        setPage(1);
        clearSelection();
    }, [clearSelection, filterActive, filterAvailability, filterFeatured, filterRarity, filterType, search]);

    const handleReorder = async (
        updates: Array<{ id: number; sortOrder: number }>
    ) => {
        const nextSortMap = new Map(
            updates.map((entry) => [entry.id, entry.sortOrder] as const)
        );

        setItems((current) =>
            current.map((item) => ({
                ...item,
                sortOrder: nextSortMap.get(item.id) ?? item.sortOrder,
            }))
        );
        setReorderSaving(true);

        try {
            const response = await fetch("/api/admin/shop-items/reorder", {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({ updates }),
            });

            if (!response.ok) {
                await loadItems();
            }
        } catch {
            await loadItems();
        } finally {
            setReorderSaving(false);
        }
    };

    const openCreate = () => {
        setEditingItem(null);
        setForm(emptyItem);
        setShowModal(true);
    };

    const openEdit = (item: ShopItem) => {
        setEditingItem(item);
        setForm({
            code: item.code,
            type: item.type,
            name: item.name,
            rarity: item.rarity,
            renderMode: item.renderMode,
            renderSpecVersion: item.renderSpecVersion,
            priceCoin: item.priceCoin,
            imageUrl: item.imageUrl,
            thumbnailUrl: item.thumbnailUrl || "",
            templateKey: item.templateKey || "",
            templateConfigText: stringifyTemplateConfig(item.templateConfig),
            badgeText: item.badgeText || "",
            availabilityMode: item.availabilityMode,
            startsAt: toDateTimeLocalInput(item.startsAt),
            endsAt: toDateTimeLocalInput(item.endsAt),
            isFeatured: item.isFeatured,
            isActive: item.isActive,
            sortOrder: item.sortOrder,
        });
        setShowModal(true);
    };

    const handleSave = async () => {
        setSaving(true);
        try {
            const payload = {
                code: form.code.trim(),
                type: form.type,
                name: form.name.trim(),
                rarity: form.rarity,
                renderMode: form.renderMode,
                renderSpecVersion: form.renderSpecVersion,
                priceCoin: form.priceCoin,
                imageUrl: form.imageUrl.trim(),
                thumbnailUrl: form.thumbnailUrl.trim() || null,
                templateKey: form.templateKey.trim() || null,
                templateConfig: parseTemplateConfig(form.templateConfigText),
                badgeText: form.badgeText.trim() || null,
                availabilityMode: form.availabilityMode,
                startsAt: toIsoDateTime(form.startsAt),
                endsAt: toIsoDateTime(form.endsAt),
                isFeatured: form.isFeatured,
                isActive: form.isActive,
                sortOrder: form.sortOrder,
            };

            const url = editingItem ? `/api/admin/shop-items/${editingItem.id}` : "/api/admin/shop-items";
            const method = editingItem ? "PUT" : "POST";
            const response = await fetch(url, {
                method,
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify(payload),
            });

            if (!response.ok) {
                const errorPayload = (await response.json().catch(() => ({ error: "Kozmetik kaydedilemedi." }))) as { error?: string };
                toast.error(errorPayload.error || "Kozmetik kaydedilemedi.");
                return;
            }

            setShowModal(false);
            toast.success(editingItem ? "Kozmetik güncellendi." : "Kozmetik oluşturuldu.");
            await loadItems();
        } catch (error) {
            toast.error(error instanceof Error ? error.message : "Template config geçersiz.");
        } finally {
            setSaving(false);
        }
    };

    const updateItem = useCallback(async (itemId: number, patch: Partial<ShopItem>) => {
        const response = await fetch(`/api/admin/shop-items/${itemId}`, {
            method: "PUT",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify(patch),
        });
        return response.ok;
    }, []);

    const toggleActive = async (item: ShopItem) => {
        try {
            const succeeded = await updateItem(item.id, { isActive: !item.isActive });
            if (!succeeded) {
                toast.error("Durum güncellenemedi.");
                return;
            }
            await loadItems();
        } catch {
            toast.error("Durum güncellenemedi.");
        }
    };

    const handleDelete = async (item: ShopItem) => {
        if (!window.confirm(`"${item.name}" kozmetiğini pasife almak istediğine emin misin?`)) {
            return;
        }

        try {
            const response = await fetch(`/api/admin/shop-items/${item.id}`, { method: "DELETE" });
            if (!response.ok) {
                toast.error("Kozmetik pasife alınamadı.");
                return;
            }
            toast.success("Kozmetik pasife alındı.");
            await loadItems();
        } catch {
            toast.error("Kozmetik pasife alınamadı.");
        }
    };

    const runBulkPatch = useCallback(async (patch: Partial<ShopItem>, successMessage: string) => {
        const ids = Array.from(selectedIds);
        if (ids.length === 0) {
            return;
        }

        setBulkSaving(true);
        try {
            const results = await Promise.all(ids.map((itemId) => updateItem(itemId, patch)));
            if (results.some((result) => !result)) {
                toast.error("Toplu işlem kısmen başarısız oldu.");
            } else {
                toast.success(successMessage);
            }
            clearSelection();
            await loadItems();
        } catch {
            toast.error("Toplu işlem tamamlanamadı.");
        } finally {
            setBulkSaving(false);
        }
    }, [clearSelection, loadItems, selectedIds, updateItem]);

    const handleUpload = async (
        event: ChangeEvent<HTMLInputElement>,
        target: "imageUrl" | "thumbnailUrl"
    ) => {
        const file = event.target.files?.[0];
        if (!file) {
            return;
        }

        setUploading(true);
        try {
            const formData = new FormData();
            formData.append("file", file);
            formData.append(
                "category",
                target === "thumbnailUrl" ? `${form.type}-thumbnails` : mapUploadCategory(form.type)
            );
            const response = await fetch("/api/admin/shop-items/upload", {
                method: "POST",
                body: formData,
            });

            if (!response.ok) {
                return;
            }

            const payload = (await response.json()) as { url: string };
            setForm((current) => ({ ...current, [target]: payload.url }));
        } catch {
            // Ignore upload failures for now.
        } finally {
            setUploading(false);
            event.target.value = "";
        }
    };

    const imageUploadDisabled = form.renderMode !== "image";
    const authoringPresets = useMemo(() => getCosmeticAuthoringPresets(form.type), [form.type]);
    const templateExample = authoringPresets[0]
        ? serializeCosmeticAuthoringPreset(authoringPresets[0])
        : "";
    const previewTemplateResult = useMemo(() => {
        if (form.renderMode !== "template") {
            return { config: null, error: null as string | null };
        }

        try {
            return {
                config: parseTemplateConfig(form.templateConfigText),
                error: null as string | null,
            };
        } catch (error) {
            return {
                config: null,
                error: error instanceof Error ? error.message : "Template config geçersiz.",
            };
        }
    }, [form.renderMode, form.templateConfigText]);
    const previewDraft = useMemo(() => ({
        type: form.type,
        name: form.name,
        rarity: form.rarity,
        renderMode: form.renderMode,
        renderSpecVersion: form.renderSpecVersion,
        imageUrl: form.imageUrl.trim(),
        templateKey: form.templateKey.trim() || null,
        templateConfig: previewTemplateResult.config,
        badgeText: form.badgeText.trim() || null,
        isFeatured: form.isFeatured,
        priceCoin: form.priceCoin,
    }), [form.badgeText, form.imageUrl, form.isFeatured, form.name, form.priceCoin, form.rarity, form.renderMode, form.renderSpecVersion, form.templateKey, form.type, previewTemplateResult.config]);

    return (
        <div className="space-y-6">
            <AdminPageHeader
                title="Kozmetikler"
                description="Mağaza ürünlerini filtreleme, merchandising ve toplu aksiyonlarla yönetin."
                meta={`${items.length} kayıt`}
                icon={<ImageIcon className="h-5 w-5 text-fuchsia-500" />}
                action={
                    <Button onClick={openCreate} className="gap-2">
                        <Plus size={16} />
                        Yeni Ekle
                    </Button>
                }
            />

            <ShopOrderBoard items={items} saving={reorderSaving} onReorder={(updates) => void handleReorder(updates)} />

            <AdminToolbar>
                <div className="grid flex-1 gap-3 xl:grid-cols-[minmax(0,1fr)_170px_170px_170px_170px_170px_auto]">
                    <div className="relative">
                        <Search size={16} className="absolute left-3 top-1/2 -translate-y-1/2 text-muted-foreground" />
                        <Input
                            type="text"
                            placeholder="İsim, kod veya etiket ara..."
                            value={search}
                            onChange={(event) => setSearch(event.target.value)}
                            className="pl-9"
                        />
                    </div>
                    <select
                        value={filterType}
                        onChange={(event) => setFilterType(event.target.value as ItemType | "")}
                        className="px-3 py-2 text-sm bg-background border border-border rounded-lg outline-none"
                    >
                        <option value="">Tüm Türler</option>
                        <option value="avatar">Avatar</option>
                        <option value="frame">Çerçeve</option>
                        <option value="card_back">Kart Arkası</option>
                        <option value="card_face">Kart Önü</option>
                    </select>
                    <select
                        value={filterRarity}
                        onChange={(event) => setFilterRarity(event.target.value as Rarity | "")}
                        className="px-3 py-2 text-sm bg-background border border-border rounded-lg outline-none"
                    >
                        <option value="">Tüm Nadirlikler</option>
                        <option value="common">Yaygın</option>
                        <option value="rare">Nadir</option>
                        <option value="epic">Epik</option>
                        <option value="legendary">Efsanevi</option>
                    </select>
                    <select
                        value={filterActive}
                        onChange={(event) => setFilterActive(event.target.value as ActiveFilter)}
                        className="px-3 py-2 text-sm bg-background border border-border rounded-lg outline-none"
                    >
                        <option value="all">Tüm Durumlar</option>
                        <option value="active">Aktif</option>
                        <option value="inactive">Pasif</option>
                    </select>
                    <select
                        value={filterFeatured}
                        onChange={(event) => setFilterFeatured(event.target.value as FeaturedFilter)}
                        className="px-3 py-2 text-sm bg-background border border-border rounded-lg outline-none"
                    >
                        <option value="all">Tüm Vitrinler</option>
                        <option value="featured">Vitrinde</option>
                        <option value="standard">Standart</option>
                    </select>
                    <select
                        value={filterAvailability}
                        onChange={(event) => setFilterAvailability(event.target.value as AvailabilityFilter)}
                        className="px-3 py-2 text-sm bg-background border border-border rounded-lg outline-none"
                    >
                        <option value="all">Tüm Yayın Modları</option>
                        <option value="always_on">Sürekli</option>
                        <option value="scheduled">Planlı</option>
                        <option value="seasonal">Sezonluk</option>
                        <option value="limited">Sınırlı</option>
                        <option value="event_only">Etkinlik</option>
                    </select>
                    <Button
                        type="button"
                        variant="outline"
                        onClick={() => {
                            setSearch("");
                            setFilterType("");
                            setFilterRarity("");
                            setFilterActive("all");
                            setFilterFeatured("all");
                            setFilterAvailability("all");
                        }}
                    >
                        Filtreleri Temizle
                    </Button>
                </div>
                <AdminToolbarStats
                    stats={[
                        { label: "toplam", value: String(items.length) },
                        { label: "aktif", value: String(activeCount) },
                        { label: "vitrinde", value: String(featuredCount) },
                        { label: "yayınlı", value: String(timedCount) },
                        { label: "görünen", value: String(filteredItems.length) },
                    ]}
                />
            </AdminToolbar>

            <AdminSelectionBar selectedCount={selectedCount} onClear={clearSelection}>
                <Button
                    type="button"
                    size="sm"
                    variant="outline"
                    disabled={bulkSaving}
                    onClick={() => void runBulkPatch({ isActive: true }, "Seçili ürünler aktif edildi.")}
                >
                    Aktif et
                </Button>
                <Button
                    type="button"
                    size="sm"
                    variant="outline"
                    disabled={bulkSaving}
                    onClick={() => void runBulkPatch({ isActive: false }, "Seçili ürünler pasife alındı.")}
                >
                    Gizle
                </Button>
                <Button
                    type="button"
                    size="sm"
                    variant="outline"
                    disabled={bulkSaving}
                    onClick={() => void runBulkPatch({ isFeatured: true }, "Seçili ürünler vitrine alındı.")}
                >
                    Vitrine Al
                </Button>
                <Button
                    type="button"
                    size="sm"
                    variant="outline"
                    disabled={bulkSaving}
                    onClick={() => void runBulkPatch({ isFeatured: false }, "Seçili ürünler vitrinden çıkarıldı.")}
                >
                    Vitrinden Çıkar
                </Button>
                <Button
                    type="button"
                    size="sm"
                    variant="outline"
                    disabled={bulkSaving}
                    onClick={() => void runBulkPatch({ availabilityMode: "always_on", startsAt: null, endsAt: null }, "Seçili ürünler sürekli yayına alındı.")}
                >
                    Sürekli
                </Button>
                <Button
                    type="button"
                    size="sm"
                    variant="outline"
                    disabled={bulkSaving}
                    onClick={() => void runBulkPatch({ availabilityMode: "seasonal" }, "Seçili ürünler sezonluk olarak işaretlendi.")}
                >
                    Sezonluk
                </Button>
                <Button
                    type="button"
                    size="sm"
                    variant="outline"
                    disabled={bulkSaving}
                    onClick={() => void runBulkPatch({ availabilityMode: "limited" }, "Seçili ürünler sınırlı olarak işaretlendi.")}
                >
                    Sınırlı
                </Button>
                <Button
                    type="button"
                    size="sm"
                    variant="outline"
                    disabled={bulkSaving}
                    onClick={() => void runBulkPatch({ availabilityMode: "event_only" }, "Seçili ürünler etkinlik özel olarak işaretlendi.")}
                >
                    Etkinlik
                </Button>
            </AdminSelectionBar>

            <AdminTableShell
                title="Katalog Tablosu"
                description="Filtrelenmiş katalog kayıtları burada listelenir. Sıra sürükle-bırak panelinden yönetilir."
                loading={loading}
                isEmpty={!loading && filteredItems.length === 0}
                emptyState={
                    <AdminEmptyState
                        icon={<ImageIcon className="h-6 w-6" />}
                        title="Kozmetik bulunamadı"
                        description="Mevcut filtrelerle eşleşen ürün yok."
                    />
                }
                footer={
                    <AdminPagination
                        page={paginatedItems.page}
                        pageCount={paginatedItems.pageCount}
                        onPageChange={setPage}
                    />
                }
            >
                <div className="overflow-x-auto">
                    <table className="w-full text-sm">
                        <thead>
                            <tr className="border-b border-border bg-muted/30">
                                <th className="w-10 p-3 text-center">
                                    <input
                                        type="checkbox"
                                        checked={allSelected}
                                        onChange={() => toggleAll()}
                                        aria-label="Tüm görünen ürünleri seç"
                                        className="h-4 w-4 rounded border-border"
                                    />
                                </th>
                                <th className="text-left p-3 font-medium text-muted-foreground">Görsel</th>
                                <th className="text-left p-3 font-medium text-muted-foreground">İsim / Kod</th>
                                <th className="text-left p-3 font-medium text-muted-foreground">Tür</th>
                                <th className="text-left p-3 font-medium text-muted-foreground">Render</th>
                                <th className="text-left p-3 font-medium text-muted-foreground">Nadirlik</th>
                                <th className="text-center p-3 font-medium text-muted-foreground">Vitrin</th>
                                <th className="text-center p-3 font-medium text-muted-foreground">Yayın</th>
                                <th className="text-center p-3 font-medium text-muted-foreground">Sıra</th>
                                <th className="text-right p-3 font-medium text-muted-foreground">Fiyat</th>
                                <th className="text-center p-3 font-medium text-muted-foreground">Satış</th>
                                <th className="text-center p-3 font-medium text-muted-foreground">Durum</th>
                                <th className="text-right p-3 font-medium text-muted-foreground">İşlemler</th>
                            </tr>
                        </thead>
                        <tbody>
                            {paginatedItems.items.map((item) => (
                                <tr key={item.id} className={`border-b border-border/50 transition-colors hover:bg-muted/20 ${!item.isActive ? "opacity-50" : ""}`}>
                                    <td className="p-3 text-center">
                                        <input
                                            type="checkbox"
                                            checked={selectedIds.has(item.id)}
                                            onChange={() => toggleOne(item.id)}
                                            aria-label={`${item.name} seç`}
                                            className="h-4 w-4 rounded border-border"
                                        />
                                    </td>
                                    <td className="p-3">
                                        {item.thumbnailUrl || item.imageUrl ? (
                                            <Image loader={passthroughImageLoader} unoptimized src={item.thumbnailUrl || item.imageUrl} alt={item.name} width={40} height={40} className="w-10 h-10 rounded-lg object-contain border border-border" />
                                        ) : (
                                            <div className="w-10 h-10 rounded-lg bg-muted flex items-center justify-center">
                                                <ImageIcon size={16} className="text-muted-foreground" />
                                            </div>
                                        )}
                                    </td>
                                    <td className="p-3">
                                        <div className="flex items-center gap-2">
                                            <div className="font-medium text-foreground">{item.name}</div>
                                            {item.badgeText ? (
                                                <StatusPill label={item.badgeText} tone="warning" />
                                            ) : null}
                                        </div>
                                        <div className="text-xs text-muted-foreground font-mono">{item.code}</div>
                                        <div className="mt-2 flex flex-wrap gap-2 text-[11px] text-muted-foreground">
                                            <span>Envanter: {item._count?.inventoryItems ?? 0}</span>
                                            <span>Satış: {item._count?.purchases ?? 0}</span>
                                            <Link
                                                href={buildPromotionsHref(item.code, "bundles")}
                                                className="inline-flex items-center rounded-full border border-border bg-background px-2.5 py-1 font-medium text-foreground transition hover:border-blue-400 hover:bg-blue-50/60 dark:hover:bg-blue-950/20"
                                            >
                                                Paket: {item._count?.bundleEntries ?? 0}
                                            </Link>
                                            <Link
                                                href={buildPromotionsHref(item.code, "discounts")}
                                                className="inline-flex items-center rounded-full border border-border bg-background px-2.5 py-1 font-medium text-foreground transition hover:border-blue-400 hover:bg-blue-50/60 dark:hover:bg-blue-950/20"
                                            >
                                                Kampanya: {item._count?.discountCampaigns ?? 0}
                                            </Link>
                                            <Link
                                                href={buildPromotionsHref(item.code, "coupons")}
                                                className="inline-flex items-center rounded-full border border-border bg-background px-2.5 py-1 font-medium text-foreground transition hover:border-blue-400 hover:bg-blue-50/60 dark:hover:bg-blue-950/20"
                                            >
                                                Kupon: {item._count?.couponCodes ?? 0}
                                            </Link>
                                        </div>
                                    </td>
                                    <td className="p-3 text-muted-foreground">{typeLabels[item.type]}</td>
                                    <td className="p-3 text-muted-foreground font-medium uppercase text-xs">{item.renderMode}</td>
                                    <td className="p-3">
                                        <span className={`text-[10px] font-bold uppercase px-2 py-0.5 rounded ${ADMIN_RARITY_BADGE_CLASS[item.rarity]}`}>{rarityLabels[item.rarity]}</span>
                                    </td>
                                    <td className="p-3 text-center">
                                        <StatusPill label={item.isFeatured ? "Vitrinde" : "Standart"} tone={item.isFeatured ? "accent" : "neutral"} />
                                    </td>
                                    <td className="p-3 text-center">
                                        <div className="flex flex-col items-center gap-1">
                                            <StatusPill label={availabilityLabels[item.availabilityMode]} tone={getAvailabilityTone(item.availabilityMode)} />
                                            {item.availabilityMode !== "always_on" ? (
                                                <StatusPill {...getAvailabilityWindowState(item.startsAt, item.endsAt)} />
                                            ) : null}
                                        </div>
                                    </td>
                                    <td className="p-3 text-center font-mono text-xs text-muted-foreground">{item.sortOrder}</td>
                                    <td className="p-3 text-right font-bold text-foreground">{item.priceCoin.toLocaleString()} coin</td>
                                    <td className="p-3 text-center text-muted-foreground">{item._count?.purchases ?? 0}</td>
                                    <td className="p-3 text-center">
                                        <button onClick={() => void toggleActive(item)} className={`inline-flex items-center gap-1 text-xs font-medium px-2 py-1 rounded ${item.isActive ? "bg-emerald-100 text-emerald-700 dark:bg-emerald-900/30 dark:text-emerald-400" : "bg-red-100 text-red-700 dark:bg-red-900/30 dark:text-red-400"}`} type="button">
                                            {item.isActive ? (<><Eye size={12} /> Aktif</>) : (<><EyeOff size={12} /> Gizli</>)}
                                        </button>
                                    </td>
                                    <td className="p-3 text-right">
                                        <div className="flex gap-1 justify-end">
                                            <button onClick={() => openEdit(item)} className="p-1.5 rounded-lg hover:bg-muted text-muted-foreground hover:text-foreground transition-colors" type="button">
                                                <Edit2 size={14} />
                                            </button>
                                            <button onClick={() => void handleDelete(item)} className="p-1.5 rounded-lg hover:bg-red-100 dark:hover:bg-red-900/20 text-muted-foreground hover:text-red-600 transition-colors" type="button">
                                                <Trash2 size={14} />
                                            </button>
                                        </div>
                                    </td>
                                </tr>
                            ))}
                        </tbody>
                    </table>
                </div>
            </AdminTableShell>

            {showModal && (
                <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4">
                    <div className="bg-card border border-border rounded-xl shadow-2xl w-full max-w-6xl max-h-[90vh] overflow-y-auto">
                        <div className="flex items-center justify-between p-5 border-b border-border">
                            <h2 className="text-lg font-bold text-foreground">{editingItem ? "Kozmetik Düzenle" : "Yeni Kozmetik"}</h2>
                            <button onClick={() => setShowModal(false)} className="p-1 rounded-lg hover:bg-muted transition-colors" type="button">
                                <X size={18} />
                            </button>
                        </div>
                        <div className="grid gap-6 p-5 xl:grid-cols-[minmax(0,1.2fr)_380px]">
                            <div className="space-y-4">
                                <div>
                                    <label className="block text-xs font-bold text-muted-foreground uppercase mb-1">Kod (benzersiz)</label>
                                    <input type="text" value={form.code} onChange={(event) => setForm((current) => ({ ...current, code: event.target.value }))} placeholder="signal_grid_face" className="w-full px-3 py-2 text-sm bg-background border border-border rounded-lg outline-none focus:ring-2 focus:ring-primary/50" />
                                </div>

                                <div>
                                    <label className="block text-xs font-bold text-muted-foreground uppercase mb-1">İsim</label>
                                    <input type="text" value={form.name} onChange={(event) => setForm((current) => ({ ...current, name: event.target.value }))} placeholder="Signal Grid" className="w-full px-3 py-2 text-sm bg-background border border-border rounded-lg outline-none focus:ring-2 focus:ring-primary/50" />
                                </div>

                                <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
                                    <div>
                                        <label className="block text-xs font-bold text-muted-foreground uppercase mb-1">Tür</label>
                                        <select
                                            value={form.type}
                                            onChange={(event) => {
                                                const nextType = event.target.value as ItemType;
                                                setForm((current) => ({
                                                    ...current,
                                                    type: nextType,
                                                    renderMode: nextType === "avatar" ? "image" : current.renderMode,
                                                }));
                                            }}
                                            className="w-full px-3 py-2 text-sm bg-background border border-border rounded-lg outline-none"
                                        >
                                            <option value="avatar">Avatar</option>
                                            <option value="frame">Çerçeve</option>
                                            <option value="card_back">Kart Arkası</option>
                                            <option value="card_face">Kart Önü</option>
                                        </select>
                                    </div>
                                    <div>
                                        <label className="block text-xs font-bold text-muted-foreground uppercase mb-1">Nadirlik</label>
                                        <select value={form.rarity} onChange={(event) => setForm((current) => ({ ...current, rarity: event.target.value as Rarity }))} className="w-full px-3 py-2 text-sm bg-background border border-border rounded-lg outline-none">
                                            <option value="common">Yaygın</option>
                                            <option value="rare">Nadir</option>
                                            <option value="epic">Epik</option>
                                            <option value="legendary">Efsanevi</option>
                                        </select>
                                    </div>
                                    <div>
                                        <label className="block text-xs font-bold text-muted-foreground uppercase mb-1">Render</label>
                                        <select value={form.renderMode} onChange={(event) => setForm((current) => ({ ...current, renderMode: event.target.value as RenderMode }))} disabled={form.type === "avatar"} className="w-full px-3 py-2 text-sm bg-background border border-border rounded-lg outline-none disabled:opacity-60">
                                            <option value="image">Image</option>
                                            <option value="template">Template</option>
                                        </select>
                                    </div>
                                </div>

                                <div className="grid grid-cols-1 md:grid-cols-4 gap-3">
                                    <div>
                                        <label className="block text-xs font-bold text-muted-foreground uppercase mb-1">Fiyat (Coin)</label>
                                        <input type="number" min={0} value={form.priceCoin} onChange={(event) => setForm((current) => ({ ...current, priceCoin: Number.parseInt(event.target.value, 10) || 0 }))} className="w-full px-3 py-2 text-sm bg-background border border-border rounded-lg outline-none focus:ring-2 focus:ring-primary/50" />
                                    </div>
                                    <div>
                                        <label className="block text-xs font-bold text-muted-foreground uppercase mb-1">Render Spec Versiyon</label>
                                        <input type="number" min={1} max={CURRENT_COSMETIC_RENDER_SPEC_VERSION} value={form.renderSpecVersion} onChange={(event) => setForm((current) => ({ ...current, renderSpecVersion: Math.min(CURRENT_COSMETIC_RENDER_SPEC_VERSION, Math.max(1, Number.parseInt(event.target.value, 10) || 1)) }))} className="w-full px-3 py-2 text-sm bg-background border border-border rounded-lg outline-none focus:ring-2 focus:ring-primary/50" />
                                    </div>
                                    <div>
                                        <label className="block text-xs font-bold text-muted-foreground uppercase mb-1">Sıralama</label>
                                        <input type="number" value={form.sortOrder} onChange={(event) => setForm((current) => ({ ...current, sortOrder: Number.parseInt(event.target.value, 10) || 0 }))} className="w-full px-3 py-2 text-sm bg-background border border-border rounded-lg outline-none focus:ring-2 focus:ring-primary/50" />
                                    </div>
                                    <div>
                                        <label className="block text-xs font-bold text-muted-foreground uppercase mb-1">Etiket</label>
                                        <input type="text" value={form.badgeText} onChange={(event) => setForm((current) => ({ ...current, badgeText: event.target.value.toUpperCase() }))} placeholder="YENİ / SINIRLI" className="w-full px-3 py-2 text-sm bg-background border border-border rounded-lg outline-none focus:ring-2 focus:ring-primary/50" />
                                    </div>
                                </div>

                                <div className="rounded-xl border border-border/60 bg-muted/20 p-4 space-y-3">
                                    <div>
                                        <h3 className="text-sm font-semibold text-foreground">Yayın modeli</h3>
                                        <p className="text-xs text-muted-foreground">Sürekli, planlı, sezonluk, sınırlı veya etkinliğe özel görünürlüğü buradan yönetin.</p>
                                    </div>
                                    <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
                                        <div>
                                            <label className="block text-xs font-bold text-muted-foreground uppercase mb-1">Yayın Modu</label>
                                            <select value={form.availabilityMode} onChange={(event) => setForm((current) => ({ ...current, availabilityMode: event.target.value as AvailabilityMode }))} className="w-full px-3 py-2 text-sm bg-background border border-border rounded-lg outline-none">
                                                <option value="always_on">Sürekli</option>
                                                <option value="scheduled">Planlı</option>
                                                <option value="seasonal">Sezonluk</option>
                                                <option value="limited">Sınırlı</option>
                                                <option value="event_only">Etkinlik Özel</option>
                                            </select>
                                        </div>
                                        <div>
                                            <label className="block text-xs font-bold text-muted-foreground uppercase mb-1">Başlangıç</label>
                                            <input type="datetime-local" value={form.startsAt} onChange={(event) => setForm((current) => ({ ...current, startsAt: event.target.value }))} className="w-full px-3 py-2 text-sm bg-background border border-border rounded-lg outline-none focus:ring-2 focus:ring-primary/50" />
                                        </div>
                                        <div>
                                            <label className="block text-xs font-bold text-muted-foreground uppercase mb-1">Bitiş</label>
                                            <input type="datetime-local" value={form.endsAt} onChange={(event) => setForm((current) => ({ ...current, endsAt: event.target.value }))} className="w-full px-3 py-2 text-sm bg-background border border-border rounded-lg outline-none focus:ring-2 focus:ring-primary/50" />
                                        </div>
                                    </div>
                                </div>

                                <div className="rounded-xl border border-border/60 p-4 space-y-3 bg-muted/20">
                                    <div className="flex items-center justify-between gap-3">
                                        <div>
                                            <h3 className="text-sm font-semibold text-foreground">Render Kaynağı</h3>
                                            <p className="text-xs text-muted-foreground">Image ürünler URL kullanır, template ürünler key + config ile render edilir.</p>
                                        </div>
                                        <span className="text-[10px] uppercase font-bold text-muted-foreground">{form.renderMode}</span>
                                    </div>

                                    <div>
                                        <label className="block text-xs font-bold text-muted-foreground uppercase mb-1">Görsel URL</label>
                                        <div className="flex gap-3 items-end">
                                            <div className="flex-1">
                                                <input type="text" value={form.imageUrl} onChange={(event) => setForm((current) => ({ ...current, imageUrl: event.target.value }))} placeholder="/cosmetics/card-faces/signal-grid.png" disabled={imageUploadDisabled} className="w-full px-3 py-2 text-sm bg-background border border-border rounded-lg outline-none focus:ring-2 focus:ring-primary/50 disabled:opacity-60" />
                                            </div>
                                            <label className={`px-3 py-2 text-sm bg-muted rounded-lg transition-colors flex items-center gap-1 font-medium text-foreground shrink-0 ${imageUploadDisabled ? "opacity-50 cursor-not-allowed" : "cursor-pointer hover:bg-muted/80"}`}>
                                                <Upload size={14} />
                                                {uploading ? "..." : "Yükle"}
                                                <input type="file" accept="image/*" onChange={(event) => void handleUpload(event, "imageUrl")} disabled={imageUploadDisabled} className="hidden" />
                                            </label>
                                        </div>
                                        {form.imageUrl && (
                                            <div className="mt-2">
                                                <Image loader={passthroughImageLoader} unoptimized src={form.imageUrl} alt="Preview" width={64} height={64} className="w-16 h-16 rounded-lg object-cover border border-border" />
                                            </div>
                                        )}
                                    </div>

                                    <div>
                                        <label className="block text-xs font-bold text-muted-foreground uppercase mb-1">Grid Thumbnail URL</label>
                                        <div className="flex gap-3 items-end">
                                            <div className="flex-1">
                                                <input
                                                    type="text"
                                                    value={form.thumbnailUrl}
                                                    onChange={(event) => setForm((current) => ({ ...current, thumbnailUrl: event.target.value }))}
                                                    placeholder="/cosmetics/frame-thumbnails/royal-frame.webp"
                                                    className="w-full px-3 py-2 text-sm bg-background border border-border rounded-lg outline-none focus:ring-2 focus:ring-primary/50"
                                                />
                                            </div>
                                            <label className="shrink-0 cursor-pointer rounded-lg bg-muted px-3 py-2 text-sm font-medium text-foreground transition-colors hover:bg-muted/80">
                                                <span className="flex items-center gap-1">
                                                    <Upload size={14} />
                                                    {uploading ? "..." : "Yükle"}
                                                </span>
                                                <input type="file" accept="image/png,image/jpeg,image/webp" onChange={(event) => void handleUpload(event, "thumbnailUrl")} className="hidden" />
                                            </label>
                                        </div>
                                        <p className="mt-1.5 text-xs leading-5 text-muted-foreground">
                                            Opsiyonel. Mağaza ve envanter grid&apos;lerinde ağır renderer yerine kullanılır. Küçük WebP önerilir; boşsa sistem statik fallback üretir.
                                        </p>
                                        {form.thumbnailUrl ? (
                                            <div className="mt-2">
                                                <Image loader={passthroughImageLoader} unoptimized src={form.thumbnailUrl} alt="Grid thumbnail preview" width={96} height={96} className="h-20 w-20 rounded-lg border border-border object-contain" />
                                            </div>
                                        ) : null}
                                    </div>

                                    <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
                                        <div>
                                            <label className="block text-xs font-bold text-muted-foreground uppercase mb-1">Template Key</label>
                                            <input type="text" value={form.templateKey} onChange={(event) => setForm((current) => ({ ...current, templateKey: event.target.value }))} placeholder="signal_grid" disabled={form.renderMode !== "template"} className="w-full px-3 py-2 text-sm bg-background border border-border rounded-lg outline-none focus:ring-2 focus:ring-primary/50 disabled:opacity-60" />
                                        </div>
                                        <div className="text-xs text-muted-foreground rounded-lg border border-dashed border-border p-3 bg-background/60">
                                            Örnek alanlar: <code>palette</code>, <code>pattern</code>, <code>glow</code>, <code>motion</code>, <code>frame</code>.
                                        </div>
                                    </div>

                                    {form.renderMode === "template" ? (
                                        <div>
                                            <div className="mb-2">
                                                <h4 className="text-xs font-bold uppercase text-muted-foreground">Güvenli Başlangıç Presetleri</h4>
                                                <p className="mt-1 text-xs text-muted-foreground">Preset yalnız template key ve JSON ayarını değiştirir. Diğer ürün bilgileri korunur.</p>
                                            </div>
                                            <div className="grid gap-2 md:grid-cols-2">
                                                {authoringPresets.map((preset) => (
                                                    <button
                                                        key={preset.id}
                                                        type="button"
                                                        onClick={() => setForm((current) => ({
                                                            ...current,
                                                            templateKey: preset.templateKey,
                                                            templateConfigText: serializeCosmeticAuthoringPreset(preset),
                                                        }))}
                                                        className="rounded-xl border border-border bg-background/70 p-3 text-left transition hover:border-primary/50 hover:bg-background"
                                                    >
                                                        <span className="block text-sm font-semibold text-foreground">{preset.label}</span>
                                                        <span className="mt-1 block text-xs leading-5 text-muted-foreground">{preset.description}</span>
                                                        <code className="mt-2 block text-[11px] text-primary">{preset.templateKey}</code>
                                                    </button>
                                                ))}
                                            </div>
                                        </div>
                                    ) : null}

                                    <div>
                                        <div className="mb-1 flex items-center justify-between gap-3">
                                            <label className="block text-xs font-bold text-muted-foreground uppercase">Template Config (JSON)</label>
                                            <div className="flex items-center gap-2">
                                                <span className="text-[11px] text-muted-foreground">
                                                    Rehberler: <code>docs/dashboard-ui/cosmetic-authoring-spec.md</code> ve <code>docs/guides/card-design-guide.md</code>
                                                </span>
                                                <Button
                                                    type="button"
                                                    variant="outline"
                                                    size="sm"
                                                    disabled={form.renderMode !== "template"}
                                                    onClick={() => setForm((current) => ({ ...current, templateConfigText: templateExample }))}
                                                    className="h-7 gap-1 px-2 text-[11px]"
                                                >
                                                    <FileJson2 size={12} />
                                                    Örnek Doldur
                                                </Button>
                                            </div>
                                        </div>
                                        <textarea value={form.templateConfigText} onChange={(event) => setForm((current) => ({ ...current, templateConfigText: event.target.value }))} placeholder={templateExample} disabled={form.renderMode !== "template"} rows={14} className="w-full px-3 py-2 text-sm font-mono bg-background border border-border rounded-lg outline-none focus:ring-2 focus:ring-primary/50 disabled:opacity-60 resize-y" />
                                    </div>
                                </div>

                                <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
                                    <label className="flex items-center gap-3 cursor-pointer rounded-xl border border-border/60 bg-muted/20 px-4 py-3">
                                        <input type="checkbox" checked={form.isFeatured} onChange={(event) => setForm((current) => ({ ...current, isFeatured: event.target.checked }))} className="w-4 h-4 rounded border-border text-primary focus:ring-primary/50" />
                                        <span className="text-sm font-medium text-foreground">Vitrinde öne çıkar</span>
                                    </label>
                                    <label className="flex items-center gap-3 cursor-pointer rounded-xl border border-border/60 bg-muted/20 px-4 py-3">
                                        <input type="checkbox" checked={form.isActive} onChange={(event) => setForm((current) => ({ ...current, isActive: event.target.checked }))} className="w-4 h-4 rounded border-border text-primary focus:ring-primary/50" />
                                        <span className="text-sm font-medium text-foreground">Mağazada aktif</span>
                                    </label>
                                </div>
                            </div>

                            <div className="xl:sticky xl:top-0 xl:self-start">
                                <CosmeticLivePreview
                                    draft={previewDraft}
                                    templateConfigError={previewTemplateResult.error}
                                />
                            </div>
                        </div>
                        <div className="flex justify-end gap-2 p-5 border-t border-border">
                            <Button variant="outline" onClick={() => setShowModal(false)}>İptal</Button>
                            <Button onClick={() => void handleSave()} disabled={saving} className="gap-2">
                                <Save size={14} />
                                {saving ? "Kaydediliyor..." : "Kaydet"}
                            </Button>
                        </div>
                    </div>
                </div>
            )}
        </div>
    );
}




