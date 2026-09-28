"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { useSearchParams } from "next/navigation";
import { Edit2, Plus, Search, Trash2 } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import {
    Dialog,
    DialogContent,
    DialogDescription,
    DialogFooter,
    DialogHeader,
    DialogTitle,
} from "@/components/ui/dialog";
import {
    Sheet,
    SheetContent,
    SheetDescription,
    SheetTitle,
} from "@/components/ui/sheet";
import { AdminPageHeader } from "@/components/admin/admin-page-header";
import { AdminTableShell, AdminEmptyState } from "@/components/admin/admin-table-shell";
import { AdminToolbar, AdminToolbarStats } from "@/components/admin/admin-toolbar";
import { matchesAdminSearch } from "@/lib/admin/admin-table";
import type {
    CouponCodeView,
    DiscountCampaignView,
    PromotionDiscountType,
    PromotionTargetType,
    ShopBundleView,
    StoreItemView,
} from "@/types/economy";

type ItemOption = Pick<StoreItemView, "id" | "code" | "name" | "type">;
type PromotionSectionFilter = "all" | "bundles" | "discounts" | "coupons";
type PromotionStatusFilter = "all" | "active" | "inactive" | "scheduled" | "expired";
type PromotionEditorKind = Exclude<PromotionSectionFilter, "all">;

interface PendingLifecycleAction {
    kind: PromotionEditorKind;
    id: number;
    name: string;
    isActive: boolean;
}

interface BundleItemFormRow {
    shopItemId: string;
    sortOrder: string;
}

interface BundleFormState {
    code: string;
    name: string;
    description: string;
    priceCoin: string;
    isActive: boolean;
    sortOrder: string;
    items: BundleItemFormRow[];
}

interface DiscountFormState {
    code: string;
    name: string;
    description: string;
    targetType: PromotionTargetType;
    discountType: PromotionDiscountType;
    percentageOff: string;
    fixedCoinOff: string;
    shopItemId: string;
    bundleId: string;
    usageLimit: string;
    startsAt: string;
    endsAt: string;
    isActive: boolean;
    stackableWithCoupon: boolean;
}

interface CouponFormState {
    code: string;
    name: string;
    description: string;
    targetType: PromotionTargetType;
    discountType: PromotionDiscountType;
    percentageOff: string;
    fixedCoinOff: string;
    shopItemId: string;
    bundleId: string;
    usageLimit: string;
    startsAt: string;
    endsAt: string;
    isActive: boolean;
}

const inputClassName = "w-full rounded-xl border border-border bg-background px-3 py-2.5 text-sm text-foreground outline-none transition focus:border-blue-500";
const sectionClassName = "space-y-3 rounded-2xl border border-border/80 bg-background/80 p-4";
const helperClassName = "text-xs text-muted-foreground";
const targetTypeLabels: Record<PromotionTargetType, string> = {
    global: "Global",
    shop_item: "Ürün",
    bundle: "Paket",
};
const itemTypeLabels = {
    avatar: "Avatar",
    frame: "Çerçeve",
    card_back: "Kart Arkası",
    card_face: "Kart Önü",
} satisfies Record<ItemOption["type"], string>;

const emptyBundleForm: BundleFormState = {
    code: "",
    name: "",
    description: "",
    priceCoin: "0",
    isActive: true,
    sortOrder: "0",
    items: [{ shopItemId: "", sortOrder: "0" }],
};

const emptyDiscountForm: DiscountFormState = {
    code: "",
    name: "",
    description: "",
    targetType: "global",
    discountType: "percentage",
    percentageOff: "10",
    fixedCoinOff: "",
    shopItemId: "",
    bundleId: "",
    usageLimit: "",
    startsAt: "",
    endsAt: "",
    isActive: true,
    stackableWithCoupon: false,
};

const emptyCouponForm: CouponFormState = {
    code: "",
    name: "",
    description: "",
    targetType: "global",
    discountType: "percentage",
    percentageOff: "10",
    fixedCoinOff: "",
    shopItemId: "",
    bundleId: "",
    usageLimit: "",
    startsAt: "",
    endsAt: "",
    isActive: true,
};

function toDateTimeLocal(iso: string | null): string {
    if (!iso) {
        return "";
    }

    const date = new Date(iso);
    const year = date.getFullYear();
    const month = String(date.getMonth() + 1).padStart(2, "0");
    const day = String(date.getDate()).padStart(2, "0");
    const hours = String(date.getHours()).padStart(2, "0");
    const minutes = String(date.getMinutes()).padStart(2, "0");

    return `${year}-${month}-${day}T${hours}:${minutes}`;
}

function toIsoDateTime(value: string): string | null {
    return value ? new Date(value).toISOString() : null;
}

function toNullableInt(value: string): number | null {
    const trimmed = value.trim();
    return trimmed ? Number.parseInt(trimmed, 10) : null;
}

function PromotionTypeBadge({ label }: { label: string }) {
    return (
        <span className="rounded-full bg-muted px-2 py-0.5 text-[10px] font-bold uppercase tracking-wide text-muted-foreground">
            {label}
        </span>
    );
}

function StatusBadge({
    label,
    tone = "neutral",
}: {
    label: string;
    tone?: "neutral" | "success" | "warning" | "accent";
}) {
    const toneClassName =
        tone === "success"
            ? "border-emerald-500/30 bg-emerald-500/10 text-emerald-700 dark:text-emerald-300"
            : tone === "warning"
              ? "border-amber-500/30 bg-amber-500/10 text-amber-700 dark:text-amber-300"
              : tone === "accent"
                ? "border-blue-500/30 bg-blue-500/10 text-blue-700 dark:text-blue-300"
                : "border-border bg-muted text-muted-foreground";

    return <span className={`inline-flex rounded-full border px-2.5 py-1 text-[11px] font-semibold ${toneClassName}`}>{label}</span>;
}

function formatDiscountSummary(discountType: PromotionDiscountType, percentageOff: number | null, fixedCoinOff: number | null) {
    if (discountType === "percentage") {
        return `%${percentageOff ?? 0} indirim`;
    }

    return `${fixedCoinOff ?? 0} coin indirim`;
}

function formatTargetSummary(targetType: PromotionTargetType, shopItemId: number | null, bundleId: number | null, itemOptions: ItemOption[], bundleOptions: Array<{ id: number; name: string; code: string }>) {
    if (targetType === "global") {
        return "Tüm katalog";
    }

    if (targetType === "shop_item") {
        const item = itemOptions.find((option) => option.id === shopItemId);
        return item ? `${item.name} · ${itemTypeLabels[item.type]}` : "Seçili ürün";
    }

    const bundle = bundleOptions.find((option) => option.id === bundleId);
    return bundle ? `${bundle.name} · ${bundle.code}` : "Seçili paket";
}

function formatUsageSummary(usedCount: number, usageLimit: number | null) {
    if (!usageLimit) {
        return `${usedCount} kullanım · limitsiz`;
    }

    const remaining = Math.max(usageLimit - usedCount, 0);
    return `${usedCount} / ${usageLimit} kullanım · ${remaining} kaldı`;
}

function getScheduleSummary(startsAt: string | null, endsAt: string | null) {
    if (!startsAt && !endsAt) {
        return "Zaman sınırı yok";
    }

    const formatter = new Intl.DateTimeFormat("tr-TR", {
        day: "2-digit",
        month: "short",
        hour: "2-digit",
        minute: "2-digit",
    });

    if (startsAt && endsAt) {
        return `${formatter.format(new Date(startsAt))} - ${formatter.format(new Date(endsAt))}`;
    }

    if (startsAt) {
        return `${formatter.format(new Date(startsAt))} itibarıyla açık`;
    }

    return `${formatter.format(new Date(endsAt as string))} tarihine kadar`;
}

function getWindowState(startsAt: string | null, endsAt: string | null) {
    const now = Date.now();

    if (startsAt && new Date(startsAt).getTime() > now) {
        return { label: "Planlı", tone: "accent" as const };
    }

    if (endsAt && new Date(endsAt).getTime() < now) {
        return { label: "Süresi Doldu", tone: "warning" as const };
    }

    return { label: "Yayında", tone: "success" as const };
}

function matchesPromotionWindowStatus(
    statusFilter: PromotionStatusFilter,
    isActive: boolean,
    startsAt: string | null,
    endsAt: string | null
) {
    if (statusFilter === "all") {
        return true;
    }

    if (statusFilter === "active") {
        return isActive;
    }

    if (statusFilter === "inactive") {
        return !isActive;
    }

    if (!isActive) {
        return false;
    }

    const windowState = getWindowState(startsAt, endsAt);
    if (statusFilter === "scheduled") {
        return windowState.label === "Planlı";
    }

    if (statusFilter === "expired") {
        return windowState.label === "Süresi Doldu";
    }

    return true;
}

function matchesBundleStatus(statusFilter: PromotionStatusFilter, isActive: boolean) {
    if (statusFilter === "all") {
        return true;
    }
    if (statusFilter === "active") {
        return isActive;
    }
    if (statusFilter === "inactive") {
        return !isActive;
    }
    return false;
}

function DetailRow({ label, value }: { label: string; value: string }) {
    return (
        <div className="flex items-center justify-between gap-3 text-xs">
            <span className="text-muted-foreground">{label}</span>
            <span className="text-right font-medium text-foreground">{value}</span>
        </div>
    );
}

function buildPromotionEmptyDescription(
    entityLabel: string,
    statusFilter: PromotionStatusFilter,
    hasSearch: boolean
) {
    if (hasSearch) {
        return `Arama sonucunda gösterilecek ${entityLabel} kaydı yok.`;
    }

    if (statusFilter === "active") {
        return `Şu anda yayında olan ${entityLabel} kaydı yok.`;
    }

    if (statusFilter === "inactive") {
        return `Pasif durumda ${entityLabel} kaydı yok.`;
    }

    if (statusFilter === "scheduled") {
        return `Planlı yayında ${entityLabel} kaydı bulunmuyor.`;
    }

    if (statusFilter === "expired") {
        return `Süresi dolmuş ${entityLabel} kaydı bulunmuyor.`;
    }

    return `Gösterilecek ${entityLabel} kaydı yok.`;
}

function PromotionSectionSummaryCard({
    label,
    value,
    activeValue,
    helper,
    href,
    onClick,
}: {
    label: string;
    value: number;
    activeValue: number;
    helper: string;
    href: string;
    onClick: () => void;
}) {
    return (
        <a
            href={href}
            onClick={onClick}
            className="rounded-2xl border border-border/70 bg-background/80 px-4 py-4 transition hover:border-blue-400/60 hover:bg-background"
        >
            <div className="flex items-start justify-between gap-3">
                <div className="space-y-1">
                    <div className="text-xs font-bold uppercase tracking-[0.18em] text-muted-foreground">{label}</div>
                    <div className="text-2xl font-black text-foreground">{value}</div>
                </div>
                <StatusBadge label={`${activeValue} aktif`} tone={activeValue > 0 ? "success" : "neutral"} />
            </div>
            <div className="mt-3 text-xs text-muted-foreground">{helper}</div>
        </a>
    );
}

function FieldLabel({ label, helper }: { label: string; helper?: string }) {
    return (
        <div className="space-y-1">
            <div className="text-xs font-bold uppercase tracking-[0.18em] text-muted-foreground">{label}</div>
            {helper ? <div className={helperClassName}>{helper}</div> : null}
        </div>
    );
}

function ToggleField({
    checked,
    label,
    description,
    onChange,
}: {
    checked: boolean;
    label: string;
    description: string;
    onChange: (checked: boolean) => void;
}) {
    return (
        <label className="flex items-start gap-3 rounded-xl border border-border/70 bg-muted/20 px-3 py-3 text-sm text-foreground">
            <input
                type="checkbox"
                checked={checked}
                onChange={(event) => onChange(event.target.checked)}
                className="mt-0.5 h-4 w-4 rounded border-border"
            />
            <span className="space-y-1">
                <span className="block font-semibold">{label}</span>
                <span className={helperClassName}>{description}</span>
            </span>
        </label>
    );
}
function TargetScopeFields({
    targetType,
    shopItemId,
    bundleId,
    itemOptions,
    bundleOptions,
    onTargetTypeChange,
    onShopItemChange,
    onBundleChange,
}: {
    targetType: PromotionTargetType;
    shopItemId: string;
    bundleId: string;
    itemOptions: ItemOption[];
    bundleOptions: Array<{ id: number; name: string; code: string }>;
    onTargetTypeChange: (value: PromotionTargetType) => void;
    onShopItemChange: (value: string) => void;
    onBundleChange: (value: string) => void;
}) {
    return (
        <div className={sectionClassName}>
            <FieldLabel
                label="Hedef"
                helper="Promosyonun tüm katalogda mı, tek üründe mi yoksa bir pakette mi çalışacağını seç."
            />
            <div className="grid gap-3 md:grid-cols-3">
                <button
                    type="button"
                    aria-pressed={targetType === "global"}
                    onClick={() => onTargetTypeChange("global")}
                    className={`rounded-2xl border px-4 py-3 text-left transition ${targetType === "global" ? "border-blue-500 bg-blue-500/10" : "border-border bg-background hover:border-blue-300"}`}
                >
                    <div className="font-semibold text-foreground">Global</div>
                    <div className={helperClassName}>Tüm ürün ve paketlerde geçerli.</div>
                </button>
                <button
                    type="button"
                    aria-pressed={targetType === "shop_item"}
                    onClick={() => onTargetTypeChange("shop_item")}
                    className={`rounded-2xl border px-4 py-3 text-left transition ${targetType === "shop_item" ? "border-blue-500 bg-blue-500/10" : "border-border bg-background hover:border-blue-300"}`}
                >
                    <div className="font-semibold text-foreground">Tek Ürün</div>
                    <div className={helperClassName}>Yalnız seçilen ürün için geçerli.</div>
                </button>
                <button
                    type="button"
                    aria-pressed={targetType === "bundle"}
                    onClick={() => onTargetTypeChange("bundle")}
                    className={`rounded-2xl border px-4 py-3 text-left transition ${targetType === "bundle" ? "border-blue-500 bg-blue-500/10" : "border-border bg-background hover:border-blue-300"}`}
                >
                    <div className="font-semibold text-foreground">Paket</div>
                    <div className={helperClassName}>Yalnız seçilen paketin fiyatına uygulanır.</div>
                </button>
            </div>
            {targetType === "shop_item" ? (
                <div className="space-y-2">
                    <FieldLabel label="Hedef Ürün" helper="Kampanyanın bağlanacağı mağaza ürünü." />
                    <select className={inputClassName} value={shopItemId} onChange={(event) => onShopItemChange(event.target.value)}>
                        <option value="">Ürün seç</option>
                        {itemOptions.map((option) => (
                            <option key={option.id} value={option.id}>{option.name} ({option.type})</option>
                        ))}
                    </select>
                </div>
            ) : null}
            {targetType === "bundle" ? (
                <div className="space-y-2">
                    <FieldLabel label="Hedef Paket" helper="Kampanyanın bağlanacağı paket." />
                    <select className={inputClassName} value={bundleId} onChange={(event) => onBundleChange(event.target.value)}>
                        <option value="">Paket seç</option>
                        {bundleOptions.map((option) => (
                            <option key={option.id} value={option.id}>{option.name} ({option.code})</option>
                        ))}
                    </select>
                </div>
            ) : null}
        </div>
    );
}

function DiscountValueFields({
    discountType,
    percentageOff,
    fixedCoinOff,
    onDiscountTypeChange,
    onPercentageChange,
    onFixedCoinChange,
}: {
    discountType: PromotionDiscountType;
    percentageOff: string;
    fixedCoinOff: string;
    onDiscountTypeChange: (value: PromotionDiscountType) => void;
    onPercentageChange: (value: string) => void;
    onFixedCoinChange: (value: string) => void;
}) {
    return (
        <div className={sectionClassName}>
            <FieldLabel label="İndirim Tipi" helper="Yüzde veya sabit coin indirimi seç. Alanlar seçime göre değişir." />
            <div className="grid gap-3 md:grid-cols-2">
                <button
                    type="button"
                    aria-pressed={discountType === "percentage"}
                    onClick={() => onDiscountTypeChange("percentage")}
                    className={`rounded-2xl border px-4 py-3 text-left transition ${discountType === "percentage" ? "border-emerald-500 bg-emerald-500/10" : "border-border bg-background hover:border-emerald-300"}`}
                >
                    <div className="font-semibold text-foreground">Yüzde</div>
                    <div className={helperClassName}>Oransal indirim uygular.</div>
                </button>
                <button
                    type="button"
                    aria-pressed={discountType === "fixed_coin"}
                    onClick={() => onDiscountTypeChange("fixed_coin")}
                    className={`rounded-2xl border px-4 py-3 text-left transition ${discountType === "fixed_coin" ? "border-amber-500 bg-amber-500/10" : "border-border bg-background hover:border-amber-300"}`}
                >
                    <div className="font-semibold text-foreground">Sabit Coin</div>
                    <div className={helperClassName}>Fiyattan doğrudan coin düşürür.</div>
                </button>
            </div>
            {discountType === "percentage" ? (
                <div className="space-y-2">
                    <FieldLabel label="Yüzde Oranı" helper="1 ile 100 arasında tam sayı." />
                    <input className={inputClassName} type="number" min="1" max="100" value={percentageOff} onChange={(event) => onPercentageChange(event.target.value)} />
                </div>
            ) : (
                <div className="space-y-2">
                    <FieldLabel label="Coin İndirimi" helper="Sepetten düşülecek sabit coin miktarı." />
                    <input className={inputClassName} type="number" min="1" value={fixedCoinOff} onChange={(event) => onFixedCoinChange(event.target.value)} />
                </div>
            )}
        </div>
    );
}

function ScheduleFields({
    usageLimit,
    startsAt,
    endsAt,
    isActive,
    onUsageLimitChange,
    onStartsAtChange,
    onEndsAtChange,
    onIsActiveChange,
}: {
    usageLimit: string;
    startsAt: string;
    endsAt: string;
    isActive: boolean;
    onUsageLimitChange: (value: string) => void;
    onStartsAtChange: (value: string) => void;
    onEndsAtChange: (value: string) => void;
    onIsActiveChange: (value: boolean) => void;
}) {
    return (
        <div className={sectionClassName}>
            <FieldLabel label="Takvim ve Limit" helper="Promosyonun ne zaman aktif olacağını ve kaç kez kullanılabileceğini belirler." />
            <div className="grid gap-3 md:grid-cols-3">
                <div className="space-y-2">
                    <FieldLabel label="Kullanım Limiti" helper="Boş bırakılırsa limitsiz." />
                    <input className={inputClassName} type="number" min="1" value={usageLimit} onChange={(event) => onUsageLimitChange(event.target.value)} placeholder="Örn. 500" />
                </div>
                <div className="space-y-2">
                    <FieldLabel label="Başlangıç" helper="Boş ise hemen aktif olabilir." />
                    <input className={inputClassName} type="datetime-local" value={startsAt} onChange={(event) => onStartsAtChange(event.target.value)} />
                </div>
                <div className="space-y-2">
                    <FieldLabel label="Bitiş" helper="Boş ise manuel kapatılana kadar açık kalır." />
                    <input className={inputClassName} type="datetime-local" value={endsAt} onChange={(event) => onEndsAtChange(event.target.value)} />
                </div>
            </div>
            <ToggleField
                checked={isActive}
                label="Aktif"
                description="Pasif promosyon listede görünse de ödeme tarafında uygulanmaz."
                onChange={onIsActiveChange}
            />
        </div>
    );
}
function BundleEditor({
    form,
    itemOptions,
    editing,
    saving,
    onChange,
    onItemChange,
    onAddItem,
    onRemoveItem,
    onSubmit,
    onCancel,
}: {
    form: BundleFormState;
    itemOptions: ItemOption[];
    editing: boolean;
    saving: boolean;
    onChange: (patch: Partial<BundleFormState>) => void;
    onItemChange: (index: number, patch: Partial<BundleItemFormRow>) => void;
    onAddItem: () => void;
    onRemoveItem: (index: number) => void;
    onSubmit: () => void;
    onCancel: () => void;
}) {
    return (
        <div className="space-y-4 rounded-3xl border border-border bg-muted/20 p-5">
            <div className="flex items-start justify-between gap-4">
                <div>
                    <h3 className="text-lg font-semibold text-foreground">{editing ? "Paketi Düzenle" : "Yeni Paket"}</h3>
                    <p className={helperClassName}>Fiyatı, sıralamayı ve paket içeriğini tek yerden tanımla.</p>
                </div>
                <PromotionTypeBadge label="bundle" />
            </div>
            <div className={sectionClassName}>
                <FieldLabel label="Kimlik" helper="Kod ödeme ve seed tarafında tekil anahtar olarak kullanılır." />
                <div className="grid gap-3 md:grid-cols-2">
                    <input className={inputClassName} placeholder="Kod" value={form.code} onChange={(event) => onChange({ code: event.target.value })} />
                    <p className={helperClassName}>İsim tekrar edebilir, kod benzersiz olmalı.</p>
                    <input className={inputClassName} placeholder="İsim" value={form.name} onChange={(event) => onChange({ name: event.target.value })} />
                </div>
                <textarea className={`${inputClassName} min-h-[88px] resize-y`} placeholder="Açıklama" value={form.description} onChange={(event) => onChange({ description: event.target.value })} />
            </div>
            <div className={sectionClassName}>
                <FieldLabel label="Mağaza Ayarları" helper="Paket fiyatını ve vitrindeki sırasını belirler." />
                <div className="grid gap-3 md:grid-cols-2">
                    <input className={inputClassName} type="number" min="0" placeholder="Fiyat" value={form.priceCoin} onChange={(event) => onChange({ priceCoin: event.target.value })} />
                    <input className={inputClassName} type="number" min="0" placeholder="Sıra" value={form.sortOrder} onChange={(event) => onChange({ sortOrder: event.target.value })} />
                </div>
                <ToggleField
                    checked={form.isActive}
                    label="Aktif"
                    description="Pasif paket mağaza kataloğunda gizli kalır ama admin listesinde görünür."
                    onChange={(value) => onChange({ isActive: value })}
                />
            </div>
            <div className={sectionClassName}>
                <div className="flex items-start justify-between gap-4">
                    <FieldLabel label="Paket İçeriği" helper="Aynı ürün tekrar etmemeli. Sıralama, paket detayında görünen akışı belirler." />
                    <Button type="button" variant="outline" size="sm" onClick={onAddItem}>Satır ekle</Button>
                </div>
                <div className="space-y-3">
                    {form.items.map((item, index) => (
                        <div key={`bundle-item-${index}`} className="grid gap-3 md:grid-cols-[1fr_120px_44px]">
                            <select className={inputClassName} value={item.shopItemId} onChange={(event) => onItemChange(index, { shopItemId: event.target.value })}>
                                <option value="">Ürün seç</option>
                                {itemOptions.map((option) => (
                                    <option key={option.id} value={option.id}>{option.name} ({option.type})</option>
                                ))}
                            </select>
                            <input className={inputClassName} type="number" min="0" value={item.sortOrder} onChange={(event) => onItemChange(index, { sortOrder: event.target.value })} />
                            <Button type="button" variant="ghost" size="icon" onClick={() => onRemoveItem(index)} disabled={form.items.length === 1}><Trash2 size={14} /></Button>
                        </div>
                    ))}
                </div>
            </div>
            <div className="flex gap-2">
                <Button onClick={onSubmit} disabled={saving}>{editing ? "Güncelle" : "Oluştur"}</Button>
                {editing ? <Button variant="outline" onClick={onCancel}>İptal</Button> : null}
            </div>
        </div>
    );
}

function DiscountEditor({
    form,
    itemOptions,
    bundleOptions,
    editing,
    saving,
    onChange,
    onSubmit,
    onCancel,
}: {
    form: DiscountFormState;
    itemOptions: ItemOption[];
    bundleOptions: Array<{ id: number; name: string; code: string }>;
    editing: boolean;
    saving: boolean;
    onChange: (patch: Partial<DiscountFormState>) => void;
    onSubmit: () => void;
    onCancel: () => void;
}) {
    return (
        <div className="space-y-4 rounded-3xl border border-border bg-muted/20 p-5">
            <div className="flex items-start justify-between gap-4">
                <div>
                    <h3 className="text-lg font-semibold text-foreground">{editing ? "İndirimi Düzenle" : "Yeni İndirim Kampanyası"}</h3>
                    <p className={helperClassName}>Ödeme fiyatına otomatik uygulanan kampanya. Kuponsuz da çalışır.</p>
                </div>
                <PromotionTypeBadge label="campaign" />
            </div>
            <div className={sectionClassName}>
                <FieldLabel label="Kampanya Kimliği" helper="Kod tekil olmalıdır. Admin listesinde ve audit logda görünür." />
                <div className="grid gap-3 md:grid-cols-2">
                    <input className={inputClassName} placeholder="Kod" value={form.code} onChange={(event) => onChange({ code: event.target.value })} />
                    <p className={helperClassName}>İsim tekrar edebilir, kod benzersiz olmalı.</p>
                    <input className={inputClassName} placeholder="İsim" value={form.name} onChange={(event) => onChange({ name: event.target.value })} />
                </div>
                <textarea className={`${inputClassName} min-h-[88px] resize-y`} placeholder="Açıklama" value={form.description} onChange={(event) => onChange({ description: event.target.value })} />
            </div>
            <TargetScopeFields
                targetType={form.targetType}
                shopItemId={form.shopItemId}
                bundleId={form.bundleId}
                itemOptions={itemOptions}
                bundleOptions={bundleOptions}
                onTargetTypeChange={(value) => onChange({ targetType: value, shopItemId: "", bundleId: "" })}
                onShopItemChange={(value) => onChange({ shopItemId: value })}
                onBundleChange={(value) => onChange({ bundleId: value })}
            />
            <DiscountValueFields
                discountType={form.discountType}
                percentageOff={form.percentageOff}
                fixedCoinOff={form.fixedCoinOff}
                onDiscountTypeChange={(value) => onChange({ discountType: value, percentageOff: value === "percentage" ? form.percentageOff || "10" : "", fixedCoinOff: value === "fixed_coin" ? form.fixedCoinOff || "25" : "" })}
                onPercentageChange={(value) => onChange({ percentageOff: value })}
                onFixedCoinChange={(value) => onChange({ fixedCoinOff: value })}
            />
            <ScheduleFields
                usageLimit={form.usageLimit}
                startsAt={form.startsAt}
                endsAt={form.endsAt}
                isActive={form.isActive}
                onUsageLimitChange={(value) => onChange({ usageLimit: value })}
                onStartsAtChange={(value) => onChange({ startsAt: value })}
                onEndsAtChange={(value) => onChange({ endsAt: value })}
                onIsActiveChange={(value) => onChange({ isActive: value })}
            />
            <ToggleField
                checked={form.stackableWithCoupon}
                label="Kupon ile birikebilir"
                description="Aynı ödeme akışında bu kampanyanın üstüne ek kupon indirimi uygulanabilsin."
                onChange={(value) => onChange({ stackableWithCoupon: value })}
            />
            <div className="flex gap-2">
                <Button onClick={onSubmit} disabled={saving}>{editing ? "Güncelle" : "Oluştur"}</Button>
                {editing ? <Button variant="outline" onClick={onCancel}>İptal</Button> : null}
            </div>
        </div>
    );
}

function CouponEditor({
    form,
    itemOptions,
    bundleOptions,
    editing,
    saving,
    onChange,
    onSubmit,
    onCancel,
}: {
    form: CouponFormState;
    itemOptions: ItemOption[];
    bundleOptions: Array<{ id: number; name: string; code: string }>;
    editing: boolean;
    saving: boolean;
    onChange: (patch: Partial<CouponFormState>) => void;
    onSubmit: () => void;
    onCancel: () => void;
}) {
    return (
        <div className="space-y-4 rounded-3xl border border-border bg-muted/20 p-5">
            <div className="flex items-start justify-between gap-4">
                <div>
                    <h3 className="text-lg font-semibold text-foreground">{editing ? "Kuponu Düzenle" : "Yeni Kupon"}</h3>
                    <p className={helperClassName}>Oyuncunun elle girdiği kod. Global veya hedefli olabilir.</p>
                </div>
                <PromotionTypeBadge label="coupon" />
            </div>
            <div className={sectionClassName}>
                <FieldLabel label="Kupon Kimliği" helper="Kod oyuncuya görünür. Büyük-küçük harf normalize edilir ama okunabilir format kullan." />
                <div className="grid gap-3 md:grid-cols-2">
                    <input className={`${inputClassName} font-mono uppercase`} placeholder="SPRING25" value={form.code} onChange={(event) => onChange({ code: event.target.value.toUpperCase() })} />
                    <p className={helperClassName}>Oyuncu kuponu bu kodla girer. Kod benzersiz olmalı, isim tekrar edebilir.</p>
                    <input className={inputClassName} placeholder="İsim" value={form.name} onChange={(event) => onChange({ name: event.target.value })} />
                </div>
                <textarea className={`${inputClassName} min-h-[88px] resize-y`} placeholder="Açıklama" value={form.description} onChange={(event) => onChange({ description: event.target.value })} />
            </div>
            <TargetScopeFields
                targetType={form.targetType}
                shopItemId={form.shopItemId}
                bundleId={form.bundleId}
                itemOptions={itemOptions}
                bundleOptions={bundleOptions}
                onTargetTypeChange={(value) => onChange({ targetType: value, shopItemId: "", bundleId: "" })}
                onShopItemChange={(value) => onChange({ shopItemId: value })}
                onBundleChange={(value) => onChange({ bundleId: value })}
            />
            <DiscountValueFields
                discountType={form.discountType}
                percentageOff={form.percentageOff}
                fixedCoinOff={form.fixedCoinOff}
                onDiscountTypeChange={(value) => onChange({ discountType: value, percentageOff: value === "percentage" ? form.percentageOff || "10" : "", fixedCoinOff: value === "fixed_coin" ? form.fixedCoinOff || "25" : "" })}
                onPercentageChange={(value) => onChange({ percentageOff: value })}
                onFixedCoinChange={(value) => onChange({ fixedCoinOff: value })}
            />
            <ScheduleFields
                usageLimit={form.usageLimit}
                startsAt={form.startsAt}
                endsAt={form.endsAt}
                isActive={form.isActive}
                onUsageLimitChange={(value) => onChange({ usageLimit: value })}
                onStartsAtChange={(value) => onChange({ startsAt: value })}
                onEndsAtChange={(value) => onChange({ endsAt: value })}
                onIsActiveChange={(value) => onChange({ isActive: value })}
            />
            <div className="flex gap-2">
                <Button onClick={onSubmit} disabled={saving}>{editing ? "Güncelle" : "Oluştur"}</Button>
                {editing ? <Button variant="outline" onClick={onCancel}>İptal</Button> : null}
            </div>
        </div>
    );
}
export default function PromotionsPage() {
    const searchParams = useSearchParams();
    const deepLinkedSearch = searchParams.get("q")?.trim() ?? "";
    const [itemOptions, setItemOptions] = useState<ItemOption[]>([]);
    const [bundles, setBundles] = useState<ShopBundleView[]>([]);
    const [discounts, setDiscounts] = useState<DiscountCampaignView[]>([]);
    const [coupons, setCoupons] = useState<CouponCodeView[]>([]);
    const [loading, setLoading] = useState(true);
    const [loadError, setLoadError] = useState<string | null>(null);
    const [saving, setSaving] = useState(false);
    const [batchSaving, setBatchSaving] = useState(false);
    const [lifecycleSaving, setLifecycleSaving] = useState(false);
    const [editorKind, setEditorKind] = useState<PromotionEditorKind | null>(null);
    const [pendingLifecycleAction, setPendingLifecycleAction] =
        useState<PendingLifecycleAction | null>(null);
    const [search, setSearch] = useState(deepLinkedSearch);
    const [sectionFilter, setSectionFilter] = useState<PromotionSectionFilter>("all");
    const [statusFilter, setStatusFilter] = useState<PromotionStatusFilter>("all");
    const [editingBundleId, setEditingBundleId] = useState<number | null>(null);
    const [editingDiscountId, setEditingDiscountId] = useState<number | null>(null);
    const [editingCouponId, setEditingCouponId] = useState<number | null>(null);
    const [bundleForm, setBundleForm] = useState<BundleFormState>(emptyBundleForm);
    const [discountForm, setDiscountForm] = useState<DiscountFormState>(emptyDiscountForm);
    const [couponForm, setCouponForm] = useState<CouponFormState>(emptyCouponForm);

    const bundleOptions = useMemo(
        () => bundles.map((bundle) => ({ id: bundle.id, name: bundle.name, code: bundle.code })),
        [bundles]
    );
    const activeBundleCount = useMemo(() => bundles.filter((bundle) => bundle.isActive).length, [bundles]);
    const activeDiscountCount = useMemo(() => discounts.filter((discount) => discount.isActive).length, [discounts]);
    const activeCouponCount = useMemo(() => coupons.filter((coupon) => coupon.isActive).length, [coupons]);
    const filteredBundles = useMemo(
        () =>
            bundles.filter((bundle) =>
                matchesBundleStatus(statusFilter, bundle.isActive) &&
                matchesAdminSearch(search, [
                    bundle.name,
                    bundle.code,
                    bundle.description ?? "",
                    ...bundle.items.flatMap((item) => [item.itemName, item.itemCode, itemTypeLabels[item.itemType]]),
                ])
            ),
        [bundles, search, statusFilter]
    );
    const filteredDiscounts = useMemo(
        () =>
            discounts.filter((discount) =>
                matchesPromotionWindowStatus(statusFilter, discount.isActive, discount.startsAt, discount.endsAt) &&
                matchesAdminSearch(search, [
                    discount.name,
                    discount.code,
                    discount.description ?? "",
                    discount.targetType,
                    targetTypeLabels[discount.targetType],
                    formatTargetSummary(discount.targetType, discount.shopItemId, discount.bundleId, itemOptions, bundleOptions),
                ])
            ),
        [bundleOptions, discounts, itemOptions, search, statusFilter]
    );
    const filteredCoupons = useMemo(
        () =>
            coupons.filter((coupon) =>
                matchesPromotionWindowStatus(statusFilter, coupon.isActive, coupon.startsAt, coupon.endsAt) &&
                matchesAdminSearch(search, [
                    coupon.name,
                    coupon.code,
                    coupon.description ?? "",
                    coupon.targetType,
                    targetTypeLabels[coupon.targetType],
                    formatTargetSummary(coupon.targetType, coupon.shopItemId, coupon.bundleId, itemOptions, bundleOptions),
                ])
            ),
        [bundleOptions, coupons, itemOptions, search, statusFilter]
    );

    const visibleSectionCount =
        (sectionFilter === "all" || sectionFilter === "bundles" ? 1 : 0) +
        (sectionFilter === "all" || sectionFilter === "discounts" ? 1 : 0) +
        (sectionFilter === "all" || sectionFilter === "coupons" ? 1 : 0);

    useEffect(() => {
        setSearch(deepLinkedSearch);
    }, [deepLinkedSearch]);

    useEffect(() => {
        const applyDeepLink = () => {
            if (typeof window === "undefined") {
                return;
            }

            const nextHash = window.location.hash.replace("#", "");
            if (nextHash === "bundles" || nextHash === "discounts" || nextHash === "coupons") {
                setSectionFilter(nextHash);
                if (!loading) {
                    window.requestAnimationFrame(() => {
                        document.getElementById(nextHash)?.scrollIntoView({
                            behavior: "smooth",
                            block: "start",
                        });
                    });
                }
            }
        };

        applyDeepLink();
        window.addEventListener("hashchange", applyDeepLink);
        return () => window.removeEventListener("hashchange", applyDeepLink);
    }, [loading]);

    const loadAll = useCallback(async () => {
        setLoading(true);
        setLoadError(null);
        try {
            const [itemsResponse, bundlesResponse, discountsResponse, couponsResponse] = await Promise.all([
                fetch("/api/admin/shop-items?active=true", { cache: "no-store" }),
                fetch("/api/admin/promotions/bundles", { cache: "no-store" }),
                fetch("/api/admin/promotions/discounts", { cache: "no-store" }),
                fetch("/api/admin/promotions/coupons", { cache: "no-store" }),
            ]);

            if (!itemsResponse.ok || !bundlesResponse.ok || !discountsResponse.ok || !couponsResponse.ok) {
                setLoadError("Admin promosyon verileri yüklenemedi.");
                return;
            }

            const [itemsPayload, bundlesPayload, discountsPayload, couponsPayload] = await Promise.all([
                itemsResponse.json() as Promise<StoreItemView[]>,
                bundlesResponse.json() as Promise<ShopBundleView[]>,
                discountsResponse.json() as Promise<DiscountCampaignView[]>,
                couponsResponse.json() as Promise<CouponCodeView[]>,
            ]);

            setItemOptions(itemsPayload.map((item) => ({ id: item.id, code: item.code, name: item.name, type: item.type })));
            setBundles(bundlesPayload);
            setDiscounts(discountsPayload);
            setCoupons(couponsPayload);
        } catch {
            setLoadError("Admin promosyon verileri yüklenemedi.");
        } finally {
            setLoading(false);
        }
    }, []);

    useEffect(() => {
        void loadAll();
    }, [loadAll]);

    const closeEditor = () => {
        if (saving) return;
        setEditorKind(null);
        setEditingBundleId(null);
        setEditingDiscountId(null);
        setEditingCouponId(null);
    };

    const openNewEditor = (kind: PromotionEditorKind) => {
        setEditorKind(kind);
        if (kind === "bundles") {
            setEditingBundleId(null);
            setBundleForm(emptyBundleForm);
        } else if (kind === "discounts") {
            setEditingDiscountId(null);
            setDiscountForm(emptyDiscountForm);
        } else {
            setEditingCouponId(null);
            setCouponForm(emptyCouponForm);
        }
    };

    const openBundleEditor = (bundle: ShopBundleView) => {
        setEditingBundleId(bundle.id);
        setBundleForm({
            code: bundle.code,
            name: bundle.name,
            description: bundle.description ?? "",
            priceCoin: String(bundle.priceCoin),
            isActive: bundle.isActive,
            sortOrder: String(bundle.sortOrder),
            items: bundle.items.map((item) => ({
                shopItemId: String(item.shopItemId),
                sortOrder: String(item.sortOrder),
            })),
        });
        setEditorKind("bundles");
    };

    const openDiscountEditor = (discount: DiscountCampaignView) => {
        setEditingDiscountId(discount.id);
        setDiscountForm({
            code: discount.code,
            name: discount.name,
            description: discount.description ?? "",
            targetType: discount.targetType,
            discountType: discount.discountType,
            percentageOff: discount.percentageOff
                ? String(discount.percentageOff)
                : "",
            fixedCoinOff: discount.fixedCoinOff
                ? String(discount.fixedCoinOff)
                : "",
            shopItemId: discount.shopItemId
                ? String(discount.shopItemId)
                : "",
            bundleId: discount.bundleId ? String(discount.bundleId) : "",
            usageLimit: discount.usageLimit
                ? String(discount.usageLimit)
                : "",
            startsAt: toDateTimeLocal(discount.startsAt),
            endsAt: toDateTimeLocal(discount.endsAt),
            isActive: discount.isActive,
            stackableWithCoupon: discount.stackableWithCoupon,
        });
        setEditorKind("discounts");
    };

    const openCouponEditor = (coupon: CouponCodeView) => {
        setEditingCouponId(coupon.id);
        setCouponForm({
            code: coupon.code,
            name: coupon.name,
            description: coupon.description ?? "",
            targetType: coupon.targetType,
            discountType: coupon.discountType,
            percentageOff: coupon.percentageOff
                ? String(coupon.percentageOff)
                : "",
            fixedCoinOff: coupon.fixedCoinOff
                ? String(coupon.fixedCoinOff)
                : "",
            shopItemId: coupon.shopItemId ? String(coupon.shopItemId) : "",
            bundleId: coupon.bundleId ? String(coupon.bundleId) : "",
            usageLimit: coupon.usageLimit ? String(coupon.usageLimit) : "",
            startsAt: toDateTimeLocal(coupon.startsAt),
            endsAt: toDateTimeLocal(coupon.endsAt),
            isActive: coupon.isActive,
        });
        setEditorKind("coupons");
    };

    const saveBundle = async () => {
        setSaving(true);
        try {
            const payload = {
                code: bundleForm.code.trim(),
                name: bundleForm.name.trim(),
                description: bundleForm.description.trim() || null,
                priceCoin: Number.parseInt(bundleForm.priceCoin, 10),
                isActive: bundleForm.isActive,
                sortOrder: Number.parseInt(bundleForm.sortOrder, 10),
                items: bundleForm.items.map((item) => ({
                    shopItemId: Number.parseInt(item.shopItemId, 10),
                    sortOrder: Number.parseInt(item.sortOrder, 10),
                })),
            };
            const response = await fetch(editingBundleId ? `/api/admin/promotions/bundles/${editingBundleId}` : "/api/admin/promotions/bundles", {
                method: editingBundleId ? "PUT" : "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify(payload),
            });
            if (!response.ok) {
                const errorPayload = (await response.json().catch(() => ({ error: "Bundle kaydedilemedi." }))) as { error?: string };
                toast.error(errorPayload.error || "Paket kaydedilemedi.");
                return;
            }
            toast.success(editingBundleId ? "Paket güncellendi." : "Paket oluşturuldu.");
            setEditingBundleId(null);
            setBundleForm(emptyBundleForm);
            setEditorKind(null);
            await loadAll();
        } catch {
            toast.error("Paket kaydedilemedi. Bağlantıyı kontrol edip tekrar deneyin.");
        } finally {
            setSaving(false);
        }
    };

    const saveDiscount = async () => {
        setSaving(true);
        try {
            const payload = {
                code: discountForm.code.trim(),
                name: discountForm.name.trim(),
                description: discountForm.description.trim() || null,
                targetType: discountForm.targetType,
                discountType: discountForm.discountType,
                percentageOff: discountForm.discountType === "percentage" ? toNullableInt(discountForm.percentageOff) : null,
                fixedCoinOff: discountForm.discountType === "fixed_coin" ? toNullableInt(discountForm.fixedCoinOff) : null,
                shopItemId: discountForm.targetType === "shop_item" ? toNullableInt(discountForm.shopItemId) : null,
                bundleId: discountForm.targetType === "bundle" ? toNullableInt(discountForm.bundleId) : null,
                usageLimit: toNullableInt(discountForm.usageLimit),
                startsAt: toIsoDateTime(discountForm.startsAt),
                endsAt: toIsoDateTime(discountForm.endsAt),
                isActive: discountForm.isActive,
                stackableWithCoupon: discountForm.stackableWithCoupon,
            };
            const response = await fetch(editingDiscountId ? `/api/admin/promotions/discounts/${editingDiscountId}` : "/api/admin/promotions/discounts", {
                method: editingDiscountId ? "PUT" : "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify(payload),
            });
            if (!response.ok) {
                const errorPayload = (await response.json().catch(() => ({ error: "Indirim kaydedilemedi." }))) as { error?: string };
                toast.error(errorPayload.error || "İndirim kaydedilemedi.");
                return;
            }
            toast.success(editingDiscountId ? "Kampanya güncellendi." : "Kampanya oluşturuldu.");
            setEditingDiscountId(null);
            setDiscountForm(emptyDiscountForm);
            setEditorKind(null);
            await loadAll();
        } catch {
            toast.error("Kampanya kaydedilemedi. Bağlantıyı kontrol edip tekrar deneyin.");
        } finally {
            setSaving(false);
        }
    };

    const saveCoupon = async () => {
        setSaving(true);
        try {
            const payload = {
                code: couponForm.code.trim(),
                name: couponForm.name.trim(),
                description: couponForm.description.trim() || null,
                targetType: couponForm.targetType,
                discountType: couponForm.discountType,
                percentageOff: couponForm.discountType === "percentage" ? toNullableInt(couponForm.percentageOff) : null,
                fixedCoinOff: couponForm.discountType === "fixed_coin" ? toNullableInt(couponForm.fixedCoinOff) : null,
                shopItemId: couponForm.targetType === "shop_item" ? toNullableInt(couponForm.shopItemId) : null,
                bundleId: couponForm.targetType === "bundle" ? toNullableInt(couponForm.bundleId) : null,
                usageLimit: toNullableInt(couponForm.usageLimit),
                startsAt: toIsoDateTime(couponForm.startsAt),
                endsAt: toIsoDateTime(couponForm.endsAt),
                isActive: couponForm.isActive,
            };
            const response = await fetch(editingCouponId ? `/api/admin/promotions/coupons/${editingCouponId}` : "/api/admin/promotions/coupons", {
                method: editingCouponId ? "PUT" : "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify(payload),
            });
            if (!response.ok) {
                const errorPayload = (await response.json().catch(() => ({ error: "Kupon kaydedilemedi." }))) as { error?: string };
                toast.error(errorPayload.error || "Kupon kaydedilemedi.");
                return;
            }
            toast.success(editingCouponId ? "Kupon güncellendi." : "Kupon oluşturuldu.");
            setEditingCouponId(null);
            setCouponForm(emptyCouponForm);
            setEditorKind(null);
            await loadAll();
        } catch {
            toast.error("Kupon kaydedilemedi. Bağlantıyı kontrol edip tekrar deneyin.");
        } finally {
            setSaving(false);
        }
    };

    const confirmLifecycleAction = async () => {
        if (!pendingLifecycleAction) return;
        setLifecycleSaving(true);
        try {
            const response = await fetch(
                `/api/admin/promotions/${pendingLifecycleAction.kind}/${pendingLifecycleAction.id}`,
                { method: "DELETE" }
            );
            const payload = (await response.json().catch(() => ({}))) as {
                error?: string;
                outcome?: "deleted" | "deactivated";
            };
            if (!response.ok) {
                toast.error(payload.error || "Promosyon işlemi tamamlanamadı.");
                return;
            }

            toast.success(
                payload.outcome === "deleted"
                    ? "Kayıt kalıcı olarak silindi."
                    : "Kayıt pasife alındı."
            );
            setPendingLifecycleAction(null);
            await loadAll();
        } catch {
            toast.error("Promosyon işlemi tamamlanamadı.");
        } finally {
            setLifecycleSaving(false);
        }
    };

    const applyBulkPromotionStatus = async (
        kind: "bundles" | "discounts" | "coupons",
        isActive: boolean
    ) => {
        const entries =
            kind === "bundles"
                ? filteredBundles
                : kind === "discounts"
                  ? filteredDiscounts
                  : filteredCoupons;
        const changedEntries = entries.filter(
            (entry) => entry.isActive !== isActive
        );

        if (changedEntries.length === 0) {
            toast.info(
                entries.length === 0
                    ? "Bu filtrede işlem uygulanacak kayıt yok."
                    : "Filtredeki kayıtlar zaten seçilen durumda."
            );
            return;
        }

        setBatchSaving(true);
        try {
            const response = await fetch(
                "/api/admin/promotions/bulk-status",
                {
                    method: "PUT",
                    headers: { "Content-Type": "application/json" },
                    body: JSON.stringify({
                        kind,
                        ids: changedEntries
                            .slice(0, 100)
                            .map((entry) => entry.id),
                        isActive,
                    }),
                }
            );
            const payload = (await response.json().catch(() => ({}))) as {
                error?: string;
                updatedCount?: number;
            };
            if (!response.ok) {
                toast.error(
                    payload.error || "Toplu promosyon işlemi tamamlanamadı."
                );
                return;
            }

            const limited = changedEntries.length > 100;
            toast.success(
                `${payload.updatedCount ?? 0} kayıt ${
                    isActive ? "yayına alındı" : "durduruldu"
                }.${limited ? " İlk 100 kayıt işlendi; kalanlar için işlemi tekrarlayın." : ""}`
            );
            await loadAll();
        } catch {
            toast.error("Toplu promosyon işlemi tamamlanamadı.");
        } finally {
            setBatchSaving(false);
        }
    };
    return (
        <div className="space-y-6">
            <AdminPageHeader
                title="Promosyonlar"
                description="Paket, otomatik kampanya ve kupon akışlarını aynı operasyon panelinde yönetin."
                meta={`${bundles.length + discounts.length + coupons.length} kayıt`}
                action={null}
            />

            <AdminToolbar>
                <div className="relative flex-1">
                    <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
                    <Input
                        value={search}
                        onChange={(event) => setSearch(event.target.value)}
                        placeholder="Paket, kampanya veya kupon ara..."
                        className="pl-9"
                    />
                </div>
                <AdminToolbarStats
                    stats={[
                        { label: "paket", value: `${filteredBundles.length} / ${activeBundleCount}` },
                        { label: "kampanya", value: `${filteredDiscounts.length} / ${activeDiscountCount}` },
                        { label: "kupon", value: `${filteredCoupons.length} / ${activeCouponCount}` },
                    ]}
                />
            </AdminToolbar>

            <div className="flex flex-col gap-3 rounded-2xl border border-border/70 bg-muted/20 p-4">
                <div className="flex flex-col gap-2 lg:flex-row lg:items-center lg:justify-between">
                    <div>
                        <div className="text-xs font-bold uppercase tracking-[0.18em] text-muted-foreground">Görünüm</div>
                        <p className="text-sm text-muted-foreground">Promosyon alanını bölüm ve yayın durumuna göre daraltarak kontrol et.</p>
                    </div>
                    <div className="flex flex-wrap gap-2">
                        {([
                            { id: "all", label: "Tümü" },
                            { id: "bundles", label: "Paketler" },
                            { id: "discounts", label: "Kampanyalar" },
                            { id: "coupons", label: "Kuponlar" },
                        ] as const).map((option) => (
                            <Button
                                key={option.id}
                                type="button"
                                aria-pressed={sectionFilter === option.id}
                                size="sm"
                                variant={sectionFilter === option.id ? "default" : "outline"}
                                onClick={() => setSectionFilter(option.id)}
                            >
                                {option.label}
                            </Button>
                        ))}
                    </div>
                </div>
                <div className="flex flex-wrap gap-2">
                    {([
                        { id: "all", label: "Tüm Durumlar" },
                        { id: "active", label: "Aktif" },
                        { id: "inactive", label: "Pasif" },
                        { id: "scheduled", label: "Planlı" },
                        { id: "expired", label: "Süresi Doldu" },
                    ] as const).map((option) => (
                        <Button
                            key={option.id}
                            type="button"
                            aria-pressed={statusFilter === option.id}
                            size="sm"
                            variant={statusFilter === option.id ? "default" : "outline"}
                            onClick={() => setStatusFilter(option.id)}
                        >
                            {option.label}
                        </Button>
                    ))}
                </div>
                <div className="grid gap-3 md:grid-cols-3">
                    <PromotionSectionSummaryCard
                        label="Paketler"
                        value={filteredBundles.length}
                        activeValue={activeBundleCount}
                        helper="Paket fiyatı, vitrin sırası ve içerik listesi."
                        href="#bundles"
                        onClick={() => setSectionFilter("bundles")}
                    />
                    <PromotionSectionSummaryCard
                        label="Kampanyalar"
                        value={filteredDiscounts.length}
                        activeValue={activeDiscountCount}
                        helper="Kuponsuz otomatik indirim akışını izler."
                        href="#discounts"
                        onClick={() => setSectionFilter("discounts")}
                    />
                    <PromotionSectionSummaryCard
                        label="Kuponlar"
                        value={filteredCoupons.length}
                        activeValue={activeCouponCount}
                        helper="Oyuncunun elle girdiği indirim kodlarını toplar."
                        href="#coupons"
                        onClick={() => setSectionFilter("coupons")}
                    />
                </div>
            </div>

            {deepLinkedSearch ? (
                <div className="rounded-2xl border border-blue-500/20 bg-blue-500/5 px-4 py-3 text-sm text-muted-foreground">
                    Bu ekran derin bağlantı ile açıldı. Arama filtresi şu değeri kullanıyor:
                    <span className="ml-2 font-semibold text-foreground">{deepLinkedSearch}</span>
                </div>
            ) : null}

            {loading ? (
                <AdminTableShell loading title="Promosyon verileri" description="Admin kaynakları yükleniyor.">
                    <div />
                </AdminTableShell>
            ) : null}
            {loadError ? (
                <Card>
                    <CardContent className="p-6 text-sm text-red-500">{loadError}</CardContent>
                </Card>
            ) : null}

            {!loading && !loadError ? (
            <div className={`grid gap-6 ${visibleSectionCount > 1 ? "xl:grid-cols-2" : ""}`}>
                {(sectionFilter === "all" || sectionFilter === "bundles") ? (
                <Card id="bundles">
                    <CardHeader className="flex flex-col items-start justify-between gap-4 lg:flex-row lg:items-center">
                        <div className="space-y-2">
                            <CardTitle>Paket Tanımları</CardTitle>
                            <p className="text-sm text-muted-foreground">Filtrelenmiş paketler üzerinde hızlı yayın kontrolü ve içerik yönetimi.</p>
                        </div>
                        <div className="flex w-full flex-wrap gap-2 lg:w-auto lg:justify-end">
                            <Button size="sm" variant="outline" disabled={batchSaving} onClick={() => void applyBulkPromotionStatus("bundles", true)}>Filtredekileri Yayına Al</Button>
                            <Button size="sm" variant="outline" disabled={batchSaving} onClick={() => void applyBulkPromotionStatus("bundles", false)}>Filtredekileri Durdur</Button>
                            <Button size="sm" onClick={() => openNewEditor("bundles")} className="gap-2"><Plus size={14} />Yeni Paket</Button>
                        </div>
                    </CardHeader>
                    <CardContent className="space-y-4">
                        {filteredBundles.length === 0 ? (
                            <AdminEmptyState
                                title="Paket bulunamadı"
                                description={buildPromotionEmptyDescription("paket", statusFilter, search.trim().length > 0)}
                            />
                        ) : null}
                        {filteredBundles.map((bundle) => (
                            <div key={bundle.id} data-testid={`promotion-bundle-${bundle.id}`} className="rounded-3xl border border-border/80 bg-card p-4 shadow-sm">
                                <div className="flex flex-col items-start justify-between gap-3 sm:flex-row">
                                    <div className="space-y-3">
                                        <div className="flex flex-wrap items-center gap-2">
                                            <PromotionTypeBadge label="paket" />
                                            <h3 className="font-semibold text-foreground">{bundle.name}</h3>
                                            <StatusBadge label={bundle.isActive ? "Aktif" : "Pasif"} tone={bundle.isActive ? "success" : "neutral"} />
                                            <StatusBadge label={`${bundle.items.length} ürün`} />
                                        </div>
                                        <p className="font-mono text-xs text-muted-foreground">{bundle.code}</p>
                                        <p className="text-sm text-muted-foreground">{bundle.description || "Açıklama eklenmemiş."}</p>
                                    </div>
                                    <div className="flex w-full flex-wrap gap-2 sm:w-auto sm:justify-end">
                                        <Button
                                            variant="outline"
                                            size="sm"
                                            className="gap-2"
                                            data-testid={`promotion-bundle-edit-${bundle.id}`}
                                            onClick={() => openBundleEditor(bundle)}
                                        >
                                            <Edit2 size={14} />
                                            Düzenle
                                        </Button>
                                        <Button
                                            variant="ghost"
                                            size="sm"
                                            className="gap-2"
                                            data-testid={`promotion-bundle-lifecycle-${bundle.id}`}
                                            onClick={() =>
                                                setPendingLifecycleAction({
                                                    kind: "bundles",
                                                    id: bundle.id,
                                                    name: bundle.name,
                                                    isActive: bundle.isActive,
                                                })
                                            }
                                        >
                                            <Trash2 size={14} />
                                            {bundle.isActive ? "Pasife Al" : "Sil"}
                                        </Button>
                                    </div>
                                </div>
                                <div className="mt-4 grid gap-2 rounded-2xl border border-border/70 bg-muted/20 p-3 sm:grid-cols-2">
                                    <DetailRow label="Liste fiyatı" value={`${bundle.priceCoin.toLocaleString()} coin`} />
                                    <DetailRow label="Vitrin sırası" value={String(bundle.sortOrder)} />
                                </div>
                                <div className="mt-4 flex flex-wrap gap-2">
                                    {bundle.items.map((item) => (
                                        <span key={item.id} className="rounded-full bg-muted px-2.5 py-1 text-[11px] text-muted-foreground">
                                            {item.itemName} · {itemTypeLabels[item.itemType]}
                                        </span>
                                    ))}
                                </div>
                            </div>
                        ))}
                    </CardContent>
                </Card>
                ) : null}

                {(sectionFilter === "all" || sectionFilter === "discounts") ? (
                <Card id="discounts">
                    <CardHeader className="flex flex-col items-start justify-between gap-4 lg:flex-row lg:items-center">
                        <div className="space-y-2">
                            <CardTitle>İndirim Kampanyaları</CardTitle>
                            <p className="text-sm text-muted-foreground">Kuponsuz çalışan kampanyaları yayın durumu ve zamanlamaya göre yönetin.</p>
                        </div>
                        <div className="flex w-full flex-wrap gap-2 lg:w-auto lg:justify-end">
                            <Button size="sm" variant="outline" disabled={batchSaving} onClick={() => void applyBulkPromotionStatus("discounts", true)}>Filtredekileri Yayına Al</Button>
                            <Button size="sm" variant="outline" disabled={batchSaving} onClick={() => void applyBulkPromotionStatus("discounts", false)}>Filtredekileri Durdur</Button>
                            <Button size="sm" onClick={() => openNewEditor("discounts")} className="gap-2"><Plus size={14} />Yeni Kampanya</Button>
                        </div>
                    </CardHeader>
                    <CardContent className="space-y-4">
                        {filteredDiscounts.length === 0 ? (
                            <AdminEmptyState
                                title="Kampanya bulunamadı"
                                description={buildPromotionEmptyDescription("indirim kampanyası", statusFilter, search.trim().length > 0)}
                            />
                        ) : null}
                        {filteredDiscounts.map((discount) => (
                            <div key={discount.id} data-testid={`promotion-discount-${discount.id}`} className="rounded-3xl border border-border/80 bg-card p-4 shadow-sm">
                                <div className="flex flex-col items-start justify-between gap-3 sm:flex-row">
                                    <div className="space-y-3">
                                        <div className="flex flex-wrap items-center gap-2">
                                            <PromotionTypeBadge label="kampanya" />
                                            <h3 className="font-semibold text-foreground">{discount.name}</h3>
                                            <StatusBadge label={discount.isActive ? "Aktif" : "Pasif"} tone={discount.isActive ? "success" : "neutral"} />
                                            <StatusBadge label={targetTypeLabels[discount.targetType]} tone="accent" />
                                            {discount.stackableWithCoupon ? <StatusBadge label="Kuponla birikir" tone="warning" /> : null}
                                            <StatusBadge {...getWindowState(discount.startsAt, discount.endsAt)} />
                                        </div>
                                        <p className="font-mono text-xs text-muted-foreground">{discount.code}</p>
                                        <p className="text-sm text-muted-foreground">{discount.description || "Açıklama eklenmemiş."}</p>
                                    </div>
                                    <div className="flex w-full flex-wrap gap-2 sm:w-auto sm:justify-end">
                                        <Button
                                            variant="outline"
                                            size="sm"
                                            className="gap-2"
                                            data-testid={`promotion-discount-edit-${discount.id}`}
                                            onClick={() => openDiscountEditor(discount)}
                                        >
                                            <Edit2 size={14} />
                                            Düzenle
                                        </Button>
                                        <Button
                                            variant="ghost"
                                            size="sm"
                                            className="gap-2"
                                            data-testid={`promotion-discount-lifecycle-${discount.id}`}
                                            onClick={() =>
                                                setPendingLifecycleAction({
                                                    kind: "discounts",
                                                    id: discount.id,
                                                    name: discount.name,
                                                    isActive: discount.isActive,
                                                })
                                            }
                                        >
                                            <Trash2 size={14} />
                                            {discount.isActive ? "Pasife Al" : "Sil"}
                                        </Button>
                                    </div>
                                </div>
                                <div className="mt-4 grid gap-2 rounded-2xl border border-border/70 bg-muted/20 p-3">
                                    <DetailRow label="İndirim" value={formatDiscountSummary(discount.discountType, discount.percentageOff, discount.fixedCoinOff)} />
                                    <DetailRow label="Hedef" value={formatTargetSummary(discount.targetType, discount.shopItemId, discount.bundleId, itemOptions, bundleOptions)} />
                                    <DetailRow label="Kullanım" value={formatUsageSummary(discount.usedCount, discount.usageLimit)} />
                                    <DetailRow label="Zamanlama" value={getScheduleSummary(discount.startsAt, discount.endsAt)} />
                                </div>
                            </div>
                        ))}
                    </CardContent>
                </Card>
                ) : null}
            </div>
            ) : null}

            {!loading && !loadError && (sectionFilter === "all" || sectionFilter === "coupons") ? (
            <Card id="coupons">
                <CardHeader className="flex flex-col items-start justify-between gap-4 lg:flex-row lg:items-center">
                    <div className="space-y-2">
                        <CardTitle>Kupon Kodları</CardTitle>
                        <p className="text-sm text-muted-foreground">Oyuncunun girdiği kodların hedefini, limitini ve yayın penceresini tek yerden kontrol et.</p>
                    </div>
                    <div className="flex w-full flex-wrap gap-2 lg:w-auto lg:justify-end">
                        <Button size="sm" variant="outline" disabled={batchSaving} onClick={() => void applyBulkPromotionStatus("coupons", true)}>Filtredekileri Yayına Al</Button>
                        <Button size="sm" variant="outline" disabled={batchSaving} onClick={() => void applyBulkPromotionStatus("coupons", false)}>Filtredekileri Durdur</Button>
                        <Button size="sm" onClick={() => openNewEditor("coupons")} className="gap-2"><Plus size={14} />Yeni Kupon</Button>
                    </div>
                </CardHeader>
                <CardContent className="space-y-4">
                    {filteredCoupons.length === 0 ? (
                        <AdminEmptyState
                            title="Kupon bulunamadı"
                            description={buildPromotionEmptyDescription("kupon", statusFilter, search.trim().length > 0)}
                        />
                    ) : null}
                    {filteredCoupons.map((coupon) => (
                        <div key={coupon.id} data-testid={`promotion-coupon-${coupon.id}`} className="rounded-3xl border border-border/80 bg-card p-4 shadow-sm">
                            <div className="flex flex-col items-start justify-between gap-3 sm:flex-row">
                                <div className="space-y-3">
                                    <div className="flex flex-wrap items-center gap-2">
                                        <PromotionTypeBadge label="kupon" />
                                        <h3 className="font-semibold text-foreground">{coupon.name}</h3>
                                        <StatusBadge label={coupon.isActive ? "Aktif" : "Pasif"} tone={coupon.isActive ? "success" : "neutral"} />
                                        <StatusBadge label={targetTypeLabels[coupon.targetType]} tone="accent" />
                                        <StatusBadge {...getWindowState(coupon.startsAt, coupon.endsAt)} />
                                    </div>
                                    <p className="font-mono text-xs text-muted-foreground">{coupon.code}</p>
                                    <p className="text-sm text-muted-foreground">{coupon.description || "Açıklama eklenmemiş."}</p>
                                </div>
                                <div className="flex w-full flex-wrap gap-2 sm:w-auto sm:justify-end">
                                    <Button
                                        variant="outline"
                                        size="sm"
                                        className="gap-2"
                                        data-testid={`promotion-coupon-edit-${coupon.id}`}
                                        onClick={() => openCouponEditor(coupon)}
                                    >
                                        <Edit2 size={14} />
                                        Düzenle
                                    </Button>
                                    <Button
                                        variant="ghost"
                                        size="sm"
                                        className="gap-2"
                                        data-testid={`promotion-coupon-lifecycle-${coupon.id}`}
                                        onClick={() =>
                                            setPendingLifecycleAction({
                                                kind: "coupons",
                                                id: coupon.id,
                                                name: coupon.name,
                                                isActive: coupon.isActive,
                                            })
                                        }
                                    >
                                        <Trash2 size={14} />
                                        {coupon.isActive ? "Pasife Al" : "Sil"}
                                    </Button>
                                </div>
                            </div>
                            <div className="mt-4 grid gap-2 rounded-2xl border border-border/70 bg-muted/20 p-3">
                                <DetailRow label="İndirim" value={formatDiscountSummary(coupon.discountType, coupon.percentageOff, coupon.fixedCoinOff)} />
                                <DetailRow label="Hedef" value={formatTargetSummary(coupon.targetType, coupon.shopItemId, coupon.bundleId, itemOptions, bundleOptions)} />
                                <DetailRow label="Kullanım" value={formatUsageSummary(coupon.usedCount, coupon.usageLimit)} />
                                <DetailRow label="Zamanlama" value={getScheduleSummary(coupon.startsAt, coupon.endsAt)} />
                            </div>
                        </div>
                    ))}
                </CardContent>
            </Card>
            ) : null}

            <Sheet
                open={editorKind !== null}
                onOpenChange={(open) => {
                    if (!open) closeEditor();
                }}
            >
                <SheetContent
                    className="w-full overflow-y-auto p-3 sm:max-w-2xl sm:p-5"
                    showCloseButton={!saving}
                >
                    <SheetTitle className="sr-only">
                        Promosyon editörü
                    </SheetTitle>
                    <SheetDescription className="sr-only">
                        Paket, kampanya veya kupon oluşturma ve düzenleme alanı.
                    </SheetDescription>
                    {editorKind === "bundles" ? (
                        <BundleEditor
                            form={bundleForm}
                            itemOptions={itemOptions}
                            editing={editingBundleId !== null}
                            saving={saving}
                            onChange={(patch) =>
                                setBundleForm((current) => ({
                                    ...current,
                                    ...patch,
                                }))
                            }
                            onItemChange={(index, patch) =>
                                setBundleForm((current) => ({
                                    ...current,
                                    items: current.items.map((item, itemIndex) =>
                                        itemIndex === index
                                            ? { ...item, ...patch }
                                            : item
                                    ),
                                }))
                            }
                            onAddItem={() =>
                                setBundleForm((current) => ({
                                    ...current,
                                    items: [
                                        ...current.items,
                                        {
                                            shopItemId: "",
                                            sortOrder: String(
                                                current.items.length
                                            ),
                                        },
                                    ],
                                }))
                            }
                            onRemoveItem={(index) =>
                                setBundleForm((current) => ({
                                    ...current,
                                    items: current.items.filter(
                                        (_, itemIndex) => itemIndex !== index
                                    ),
                                }))
                            }
                            onSubmit={() => void saveBundle()}
                            onCancel={closeEditor}
                        />
                    ) : null}
                    {editorKind === "discounts" ? (
                        <DiscountEditor
                            form={discountForm}
                            itemOptions={itemOptions}
                            bundleOptions={bundleOptions}
                            editing={editingDiscountId !== null}
                            saving={saving}
                            onChange={(patch) =>
                                setDiscountForm((current) => ({
                                    ...current,
                                    ...patch,
                                }))
                            }
                            onSubmit={() => void saveDiscount()}
                            onCancel={closeEditor}
                        />
                    ) : null}
                    {editorKind === "coupons" ? (
                        <CouponEditor
                            form={couponForm}
                            itemOptions={itemOptions}
                            bundleOptions={bundleOptions}
                            editing={editingCouponId !== null}
                            saving={saving}
                            onChange={(patch) =>
                                setCouponForm((current) => ({
                                    ...current,
                                    ...patch,
                                }))
                            }
                            onSubmit={() => void saveCoupon()}
                            onCancel={closeEditor}
                        />
                    ) : null}
                </SheetContent>
            </Sheet>

            <Dialog
                open={pendingLifecycleAction !== null}
                onOpenChange={(open) => {
                    if (!open && !lifecycleSaving) {
                        setPendingLifecycleAction(null);
                    }
                }}
            >
                <DialogContent showCloseButton={!lifecycleSaving}>
                    <DialogHeader>
                        <DialogTitle>
                            {pendingLifecycleAction?.isActive
                                ? "Kaydı pasife al"
                                : "Kaydı kalıcı olarak sil"}
                        </DialogTitle>
                        <DialogDescription>
                            {pendingLifecycleAction?.isActive
                                ? "Kayıt mağaza ve ödeme akışında uygulanmayacak, ancak tekrar açılabilmek için sistemde kalacak."
                                : "Pasif ve kullanılmamış kayıt kalıcı olarak silinecek. İlişkili veya kullanılmış kayıtlar sunucu tarafından korunur."}
                        </DialogDescription>
                    </DialogHeader>
                    <div className="rounded-2xl border border-border/70 bg-muted/20 p-4">
                        <div className="text-xs font-bold uppercase tracking-[0.18em] text-muted-foreground">
                            Etkilenecek kayıt
                        </div>
                        <div className="mt-2 font-semibold text-foreground">
                            {pendingLifecycleAction?.name ?? "-"}
                        </div>
                    </div>
                    <DialogFooter>
                        <Button
                            variant="outline"
                            disabled={lifecycleSaving}
                            onClick={() => setPendingLifecycleAction(null)}
                        >
                            Vazgeç
                        </Button>
                        <Button
                            variant={
                                pendingLifecycleAction?.isActive
                                    ? "default"
                                    : "destructive"
                            }
                            disabled={lifecycleSaving}
                            onClick={() => void confirmLifecycleAction()}
                        >
                            {lifecycleSaving
                                ? "İşleniyor..."
                                : pendingLifecycleAction?.isActive
                                  ? "Pasife Al"
                                  : "Kalıcı Olarak Sil"}
                        </Button>
                    </DialogFooter>
                </DialogContent>
            </Dialog>
        </div>
    );
}


