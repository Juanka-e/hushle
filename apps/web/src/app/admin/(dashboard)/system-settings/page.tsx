"use client";

import { useCallback, useEffect, useState } from "react";
import {
    AlertTriangle,
    Coins,
    Gauge,
    ImagePlus,
    Paintbrush2,
    RefreshCcw,
    Save,
    ShieldCheck,
    SlidersHorizontal,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { isAutomaticBrandingPreviewUrl } from "@/lib/branding/assets";
import { dispatchBrandingUpdated } from "@/lib/branding/events";
import type { SystemSettingsResponse } from "@/types/system-settings";

const inputClassName = "w-full rounded-xl border border-border bg-background px-3 py-2.5 text-sm text-foreground outline-none transition focus:border-blue-500";
const helperClassName = "text-xs text-muted-foreground";
const brandingGuide = [
    "Open Graph gorseli, link paylasildiginda gorulen buyuk kart gorselidir.",
    "Tavsiye edilen olcu: 1200x630 px.",
    "Desteklenecek hedef formatlar: PNG, JPG/JPEG, WEBP.",
    "Mutlaka okunur tipografi ve guclu kontrast kullan.",
];
const sections = [
    {
        key: "platform",
        label: "Platform",
        description: "Bakim, feature gate ve operasyon davranislari.",
        icon: SlidersHorizontal,
    },
    {
        key: "branding",
        label: "Branding & SEO",
        description: "Title, OG, favicon, canonical ve arama motoru sinyalleri.",
        icon: Paintbrush2,
    },
    {
        key: "economy",
        label: "Ekonomi",
        description: "Coin, odul ve magaza carpani davranislari.",
        icon: Coins,
    },
    {
        key: "capacity",
        label: "Kapasite",
        description: "Oda sınırları, yoğunluk eşikleri ve admission kontrolü.",
        icon: Gauge,
    },
    {
        key: "security",
        label: "Guvenlik",
        description: "Captcha policy ve provider hazirligi.",
        icon: ShieldCheck,
    },
] as const;
const defaultBrandingAssetValues = {
    logoUrl: "",
    faviconUrl: "/favicon.ico",
    ogImageUrl: "",
} as const;

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

function ProviderBadge({ enabled, label }: { enabled: boolean; label: string }) {
    return (
        <span className={`rounded-full px-2.5 py-1 text-[11px] font-bold uppercase tracking-[0.18em] ${enabled ? "bg-emerald-500/12 text-emerald-600" : "bg-muted text-muted-foreground"}`}>
            {label}: {enabled ? "ready" : "missing"}
        </span>
    );
}

function BrandingAssetField({
    label,
    helper,
    placeholder,
    value,
    previewAlt,
    assetType,
    uploading,
    defaultValue,
    onChange,
    onUpload,
}: {
    label: string;
    helper: string;
    placeholder: string;
    value: string;
    previewAlt: string;
    assetType: "logo" | "favicon" | "og";
    uploading: boolean;
    defaultValue: string;
    onChange: (value: string) => void;
    onUpload: (file: File, assetType: "logo" | "favicon" | "og") => void;
}) {
    const sizeHint = "Maksimum 4 MB.";

    return (
        <div className="space-y-3 rounded-2xl border border-border/70 bg-muted/20 p-4">
            <div className="space-y-2">
                <FieldLabel label={label} helper={helper} />
                <input
                    className={inputClassName}
                    placeholder={placeholder}
                    value={value}
                    onChange={(event) => onChange(event.target.value)}
                />
            </div>

            <div className="flex flex-wrap items-center gap-3">
                <label className="inline-flex cursor-pointer items-center gap-2 rounded-full border border-border/70 bg-background px-3 py-2 text-xs font-semibold uppercase tracking-[0.16em] text-foreground transition hover:border-blue-500/40 hover:text-blue-600">
                    <ImagePlus className="h-3.5 w-3.5" />
                    {uploading ? "Yukleniyor" : "Dosya yukle"}
                    <input
                        type="file"
                        accept="image/png,image/jpeg,image/webp"
                        disabled={uploading}
                        className="hidden"
                        onChange={(event) => {
                            const file = event.target.files?.[0];
                            if (file) {
                                onUpload(file, assetType);
                            }
                            event.target.value = "";
                        }}
                    />
                </label>
                <button
                    type="button"
                    onClick={() => onChange(defaultValue)}
                    className="inline-flex items-center gap-2 rounded-full border border-border/70 bg-background px-3 py-2 text-xs font-semibold uppercase tracking-[0.16em] text-muted-foreground transition hover:border-amber-500/40 hover:text-amber-600"
                >
                    <RefreshCcw className="h-3.5 w-3.5" />
                    Varsayilana don
                </button>
                <div className="text-xs text-muted-foreground">
                    PNG, JPEG veya WebP kullan. {sizeHint} Yatay wordmark icin `Logo` kullan. Root-relative path otomatik preview edilir.
                </div>
            </div>

            {value.trim() ? (
                <div className="rounded-xl border border-border/70 bg-background p-3">
                    {isAutomaticBrandingPreviewUrl(value) ? (
                        // Root-relative branding assets are uploaded into the same app and are safe to preview directly.
                        // eslint-disable-next-line @next/next/no-img-element
                        <img
                            src={value}
                            alt={previewAlt}
                            className={`rounded-xl border border-border/70 bg-muted/30 object-contain ${
                                assetType === "favicon"
                                    ? "h-16 w-16"
                                    : assetType === "logo"
                                      ? "h-24 w-full"
                                      : "aspect-[1200/630] w-full"
                            }`}
                        />
                    ) : (
                        <div className="text-xs text-muted-foreground">
                            Dis URL kaydedildi. Guvenlik nedeniyle otomatik preview kapali.
                        </div>
                    )}
                </div>
            ) : null}
        </div>
    );
}

export default function SystemSettingsPage() {
    const isProductionBuild = process.env.NODE_ENV === "production";
    const [payload, setPayload] = useState<SystemSettingsResponse | null>(null);
    const [loading, setLoading] = useState(true);
    const [saving, setSaving] = useState(false);
    const [uploadingAsset, setUploadingAsset] = useState<"logo" | "favicon" | "og" | null>(null);
    const [error, setError] = useState("");
    const [success, setSuccess] = useState("");
    const [activeSection, setActiveSection] = useState<
        "platform" | "branding" | "economy" | "capacity" | "security"
    >("branding");
    const [activeEconomyPanel, setActiveEconomyPanel] = useState<"base" | "guard" | "group">("base");

    const loadSettings = useCallback(async () => {
        setLoading(true);
        setError("");
        try {
            const response = await fetch("/api/admin/system-settings", { cache: "no-store" });
            if (!response.ok) {
                throw new Error("Sistem ayarlari yuklenemedi.");
            }

            const nextPayload = (await response.json()) as SystemSettingsResponse;
            setPayload(nextPayload);
        } catch (loadError) {
            setError(loadError instanceof Error ? loadError.message : "Sistem ayarlari yuklenemedi.");
        } finally {
            setLoading(false);
        }
    }, []);

    useEffect(() => {
        void loadSettings();
    }, [loadSettings]);

    const updatePayload = <TSection extends keyof SystemSettingsResponse["settings"], TKey extends keyof SystemSettingsResponse["settings"][TSection]>(
        section: TSection,
        key: TKey,
        value: SystemSettingsResponse["settings"][TSection][TKey]
    ) => {
        setPayload((currentPayload) => {
            if (!currentPayload) {
                return currentPayload;
            }

            return {
                ...currentPayload,
                settings: {
                    ...currentPayload.settings,
                    [section]: {
                        ...currentPayload.settings[section],
                        [key]: value,
                    },
                },
            };
        });
    };

    const updateCaptcha = <TKey extends keyof SystemSettingsResponse["settings"]["security"]["captcha"]>(
        key: TKey,
        value: SystemSettingsResponse["settings"]["security"]["captcha"][TKey]
    ) => {
        setPayload((currentPayload) => {
            if (!currentPayload) {
                return currentPayload;
            }

            return {
                ...currentPayload,
                settings: {
                    ...currentPayload.settings,
                    security: {
                        ...currentPayload.settings.security,
                        captcha: {
                            ...currentPayload.settings.security.captcha,
                            [key]: value,
                        },
                    },
                },
            };
        });
    };

    const updateEmailVerification = (
        mode: SystemSettingsResponse["settings"]["security"]["emailVerification"]["mode"]
    ) => {
        setPayload((currentPayload) => {
            if (!currentPayload) return currentPayload;
            return {
                ...currentPayload,
                settings: {
                    ...currentPayload.settings,
                    security: {
                        ...currentPayload.settings.security,
                        emailVerification: { mode },
                    },
                },
            };
        });
    };

    const handleSave = async () => {
        if (!payload) {
            return;
        }

        setSaving(true);
        setError("");
        setSuccess("");

        try {
            const response = await fetch("/api/admin/system-settings", {
                method: "PUT",
                headers: {
                    "Content-Type": "application/json",
                },
                body: JSON.stringify(payload.settings),
            });

            const nextPayload = (await response.json()) as SystemSettingsResponse | { error?: string };
            if (!response.ok || !("settings" in nextPayload)) {
                throw new Error("error" in nextPayload && nextPayload.error ? nextPayload.error : "Sistem ayarlari kaydedilemedi.");
            }

            setPayload(nextPayload);
            dispatchBrandingUpdated(nextPayload.settings.branding);
            setSuccess("Sistem ayarlari kaydedildi.");
        } catch (saveError) {
            setError(saveError instanceof Error ? saveError.message : "Sistem ayarlari kaydedilemedi.");
        } finally {
            setSaving(false);
        }
    };

    const handleBrandingAssetUpload = async (
        file: File,
        assetType: "logo" | "favicon" | "og"
    ) => {
        setUploadingAsset(assetType);
        setError("");
        setSuccess("");

        try {
            const formData = new FormData();
            formData.append("file", file);
            formData.append("assetType", assetType);

            const response = await fetch("/api/admin/branding-assets/upload", {
                method: "POST",
                body: formData,
            });

            const payload = (await response.json()) as { url?: string; error?: string };
            if (!response.ok || !payload.url) {
                throw new Error(payload.error || "Branding asset yuklenemedi.");
            }

            if (assetType === "logo") {
                updatePayload("branding", "logoUrl", payload.url);
            } else if (assetType === "favicon") {
                updatePayload("branding", "faviconUrl", payload.url);
            } else {
                updatePayload("branding", "ogImageUrl", payload.url);
            }

            setSuccess("Branding asset yuklendi. Kaydet ile kalici hale getirebilirsin.");
        } catch (uploadError) {
            setError(uploadError instanceof Error ? uploadError.message : "Branding asset yuklenemedi.");
        } finally {
            setUploadingAsset(null);
        }
    };

    if (loading || !payload) {
        return <div className="p-6 text-sm text-muted-foreground">Sistem ayarlari yukleniyor...</div>;
    }

    const ogImageUrl = payload.settings.branding.ogImageUrl.trim();
    const canAutoPreviewOgImage = isAutomaticBrandingPreviewUrl(ogImageUrl);
    const economyPanels = [
        {
            key: "base" as const,
            label: "Temel Ekonomi",
            description: "Mac odulleri, weekend boost ve store carpanlari.",
        },
        {
            key: "guard" as const,
            label: "Odul Koruma Tavani",
            description: "Rolling window, soft cap ve hard ceiling ayarlari.",
        },
        {
            key: "group" as const,
            label: "Tekrar Eden Grup",
            description: "Ayni lineup tekrarlarinda yumusak odul dususu.",
        },
    ];

    const dampingProfileExample = {
        gentle: "Ornek: soft cap'e yaklasan oyuncu once %100 -> %90 -> %75 bandinda kalir.",
        standard: "Ornek: soft cap sonrasi %100 -> %85 -> %65 gibi daha belirgin ama hala yumusak bir dusus uygular.",
        strict: "Ornek: asiri tekrar veya hizli birikimde %100 -> %70 -> %45 gibi daha sert dusus uygular.",
    } satisfies Record<SystemSettingsResponse["settings"]["economy"]["matchRewardDampingProfile"], string>;

    return (
        <div className="space-y-6">
            <div className="flex flex-col gap-3 md:flex-row md:items-center md:justify-between">
                <div>
                    <h1 className="text-3xl font-black tracking-tight text-foreground">Sistem Ayarlari</h1>
                    <p className="mt-1 text-sm text-muted-foreground">Canli platform davranisini runtime&apos;da yonet. Secret degerler burada degil, deploy env tarafinda kalir.</p>
                </div>
                <div className="flex items-center gap-2">
                    <Button variant="outline" onClick={() => void loadSettings()} disabled={loading || saving}>
                        <RefreshCcw className="mr-2 h-4 w-4" />
                        Yenile
                    </Button>
                    <Button onClick={() => void handleSave()} disabled={saving}>
                        <Save className="mr-2 h-4 w-4" />
                        {saving ? "Kaydediliyor" : "Kaydet"}
                    </Button>
                </div>
            </div>

            {error ? <div className="rounded-2xl border border-destructive/20 bg-destructive/10 px-4 py-3 text-sm text-destructive">{error}</div> : null}
            {success ? <div className="rounded-2xl border border-emerald-500/20 bg-emerald-500/10 px-4 py-3 text-sm text-emerald-600">{success}</div> : null}

            <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
                {sections.map((section) => {
                    const Icon = section.icon;
                    const isActive = activeSection === section.key;

                    return (
                        <button
                            key={section.key}
                            type="button"
                            onClick={() => setActiveSection(section.key)}
                            className={`rounded-2xl border px-4 py-4 text-left transition ${
                                isActive
                                    ? "border-blue-500/40 bg-blue-500/10 shadow-[0_12px_40px_-24px_rgba(59,130,246,0.7)]"
                                    : "border-border/70 bg-background hover:border-blue-500/30 hover:bg-muted/30"
                            }`}
                        >
                            <div className="flex items-center gap-2 text-sm font-semibold text-foreground">
                                <Icon className="h-4 w-4" />
                                {section.label}
                            </div>
                            <div className="mt-2 text-xs leading-5 text-muted-foreground">{section.description}</div>
                        </button>
                    );
                })}
            </div>

            {activeSection === "platform" ? (
            <Card className="border-border/70">
                <CardHeader>
                    <CardTitle className="flex items-center gap-2 text-xl"><AlertTriangle className="h-5 w-5" />Platform Durumu</CardTitle>
                </CardHeader>
                <CardContent className="space-y-4">
                    <div className="grid gap-3 md:grid-cols-2">
                        <ToggleField
                            checked={payload.settings.platform.maintenanceEnabled}
                            label="Bakim Modu"
                            description="Aktifse yeni create/join, kayit ve magazaya erisim kapatilir. Admin erisimi devam eder."
                            onChange={(checked) => updatePayload("platform", "maintenanceEnabled", checked)}
                        />
                        <ToggleField
                            checked={payload.settings.platform.motdEnabled}
                            label="MOTD Banner"
                            description="Tum oyunculara ust bantta operasyonel mesaj gosterir."
                            onChange={(checked) => updatePayload("platform", "motdEnabled", checked)}
                        />
                    </div>
                    <div className="space-y-2">
                        <FieldLabel label="Bakim Mesaji" helper="Bakim modu aktif oldugunda kullaniciya donulecek ana mesaj." />
                        <textarea
                            className={`${inputClassName} min-h-24 resize-y`}
                            value={payload.settings.platform.maintenanceMessage}
                            onChange={(event) => updatePayload("platform", "maintenanceMessage", event.target.value)}
                        />
                    </div>
                    <div className="space-y-2">
                        <FieldLabel label="MOTD" helper="Dashboard ve giris yuzeyinde gosterilecek kisa canli mesaj." />
                        <textarea
                            className={`${inputClassName} min-h-20 resize-y`}
                            value={payload.settings.platform.motdText}
                            onChange={(event) => updatePayload("platform", "motdText", event.target.value)}
                        />
                    </div>
                </CardContent>
            </Card>
            ) : null}

            {activeSection === "branding" ? (
            <Card className="border-border/70">
                <CardHeader>
                    <CardTitle className="text-xl">Branding ve SEO</CardTitle>
                </CardHeader>
                <CardContent className="space-y-5">
                    <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-4">
                        <div className="space-y-2">
                            <FieldLabel label="Site Adi" helper="Open Graph, title template ve genel marka adi." />
                            <input
                                className={inputClassName}
                                value={payload.settings.branding.siteName}
                                onChange={(event) => updatePayload("branding", "siteName", event.target.value)}
                            />
                        </div>
                        <div className="space-y-2">
                            <FieldLabel label="Kisa Ad" helper="Uygulama adi ve kisaltilmis marka etiketi." />
                            <input
                                className={inputClassName}
                                value={payload.settings.branding.siteShortName}
                                onChange={(event) => updatePayload("branding", "siteShortName", event.target.value)}
                            />
                        </div>
                        <div className="space-y-2">
                            <FieldLabel label="Logo Yolu" helper="Public yuzeylerde kullanilacak ana marka gorseli." />
                            <input
                                className={inputClassName}
                                placeholder="/branding/logo/..."
                                value={payload.settings.branding.logoUrl}
                                onChange={(event) => updatePayload("branding", "logoUrl", event.target.value)}
                            />
                        </div>
                        <div className="space-y-2">
                            <FieldLabel label="Theme Color" helper="Tarayici ve platform meta theme color degeri." />
                            <input
                                className={inputClassName}
                                value={payload.settings.branding.themeColor}
                                onChange={(event) => updatePayload("branding", "themeColor", event.target.value)}
                            />
                        </div>
                        <div className="space-y-2">
                            <FieldLabel label="Twitter Handle" helper="Opsiyonel. @ olmadan da girilebilir." />
                            <input
                                className={inputClassName}
                                value={payload.settings.branding.twitterHandle}
                                onChange={(event) => updatePayload("branding", "twitterHandle", event.target.value)}
                            />
                        </div>
                    </div>

                    <div className="grid gap-4 md:grid-cols-2">
                        <div className="space-y-2">
                            <FieldLabel label="Varsayilan Title" helper="Ana sayfa ve share kartlari icin ana baslik." />
                            <input
                                className={inputClassName}
                                value={payload.settings.branding.defaultTitle}
                                onChange={(event) => updatePayload("branding", "defaultTitle", event.target.value)}
                            />
                        </div>
                        <div className="space-y-2">
                            <FieldLabel label="Title Template" helper="Sayfa bazli title varsa `%s` yerine gelir." />
                            <input
                                className={inputClassName}
                                value={payload.settings.branding.titleTemplate}
                                onChange={(event) => updatePayload("branding", "titleTemplate", event.target.value)}
                            />
                        </div>
                    </div>

                    <div className="space-y-2">
                        <FieldLabel label="Varsayilan Description" helper="SEO description, Open Graph ve Twitter kartlarinda kullanilir." />
                        <textarea
                            className={`${inputClassName} min-h-24 resize-y`}
                            value={payload.settings.branding.defaultDescription}
                            onChange={(event) => updatePayload("branding", "defaultDescription", event.target.value)}
                        />
                    </div>

                    <div className="grid gap-4 xl:grid-cols-2 2xl:grid-cols-3">
                        <BrandingAssetField
                            label="Logo Asset"
                            helper="Genis wordmark veya yatay logo. Ana sayfa, login/register ve desktop header gibi yatay yuzeylerde kullanilir."
                            placeholder="/branding/logo/..."
                            value={payload.settings.branding.logoUrl}
                            previewAlt="Logo preview"
                            assetType="logo"
                            uploading={uploadingAsset === "logo"}
                            defaultValue={defaultBrandingAssetValues.logoUrl}
                            onChange={(value) => updatePayload("branding", "logoUrl", value)}
                            onUpload={handleBrandingAssetUpload}
                        />
                        <BrandingAssetField
                            label="Favicon Asset"
                            helper="Varsayilan fallback `/favicon.ico` olarak kalir."
                            placeholder="/favicon.ico"
                            value={payload.settings.branding.faviconUrl}
                            previewAlt="Favicon preview"
                            assetType="favicon"
                            uploading={uploadingAsset === "favicon"}
                            defaultValue={defaultBrandingAssetValues.faviconUrl}
                            onChange={(value) => updatePayload("branding", "faviconUrl", value)}
                            onUpload={handleBrandingAssetUpload}
                        />
                        <BrandingAssetField
                            label="Open Graph Asset"
                            helper="Bos birakirsan varsayilan text-only share metadata calisir."
                            placeholder="https://... veya /branding/og/..."
                            value={payload.settings.branding.ogImageUrl}
                            previewAlt="Open Graph preview"
                            assetType="og"
                            uploading={uploadingAsset === "og"}
                            defaultValue={defaultBrandingAssetValues.ogImageUrl}
                            onChange={(value) => updatePayload("branding", "ogImageUrl", value)}
                            onUpload={handleBrandingAssetUpload}
                        />
                    </div>

                    <div className="grid gap-4 xl:grid-cols-[1.25fr_0.85fr]">
                        <div className="space-y-4 rounded-2xl border border-border/70 bg-muted/20 px-4 py-4 text-sm text-muted-foreground">
                            <div className="flex flex-wrap items-center gap-3">
                                <div
                                    className="h-11 w-11 rounded-2xl border border-border/70 bg-background"
                                    style={{ backgroundColor: payload.settings.branding.themeColor }}
                                />
                                <div className="min-w-0 flex-1">
                                    <div className="truncate text-sm font-semibold text-foreground">
                                        {payload.settings.branding.siteName}
                                    </div>
                                    <div className="mt-1 truncate text-xs text-muted-foreground">
                                        {payload.settings.branding.logoUrl || payload.settings.branding.faviconUrl || "/favicon.ico"}
                                    </div>
                                </div>
                                <div className="rounded-full border border-border/70 bg-background px-3 py-1 text-[11px] font-semibold uppercase tracking-[0.16em] text-muted-foreground">
                                    Theme {payload.settings.branding.themeColor}
                                </div>
                            </div>

                            <div className="rounded-2xl border border-border/70 bg-background p-4">
                                <div className="text-[11px] font-semibold uppercase tracking-[0.16em] text-muted-foreground">
                                    Tarayici sekmesi / title
                                </div>
                                <div className="mt-3 truncate text-base font-semibold text-foreground">
                                    {payload.settings.branding.defaultTitle}
                                </div>
                                <div className="mt-2 text-xs text-muted-foreground">
                                    Template: {payload.settings.branding.titleTemplate}
                                </div>
                                <div className="mt-2 line-clamp-2 text-sm text-muted-foreground">
                                    {payload.settings.branding.defaultDescription}
                                </div>
                            </div>

                            <div className="rounded-[28px] border border-border/70 bg-background p-3 shadow-[0_16px_50px_-30px_rgba(15,23,42,0.6)]">
                                <div className="rounded-[22px] border border-border/70 bg-muted/20 p-3">
                                    {ogImageUrl && canAutoPreviewOgImage ? (
                                        // External preview URLs are operator-controlled and may not be in Next image remotePatterns.
                                        // Only root-relative app assets are previewed automatically.
                                        // eslint-disable-next-line @next/next/no-img-element
                                        <img
                                            src={ogImageUrl}
                                            alt="Open Graph preview"
                                            className="aspect-[1200/630] w-full rounded-2xl object-cover"
                                        />
                                    ) : ogImageUrl ? (
                                        <div className="space-y-3 rounded-2xl border border-dashed border-border/70 bg-muted/40 p-4 text-left text-xs text-muted-foreground">
                                            <div className="font-semibold uppercase tracking-[0.16em] text-foreground">
                                                Otomatik preview kapali
                                            </div>
                                            <div>
                                                Dis URL gorselleri admin tarayicisindan otomatik yuklenmez. Burada sadece root-relative app asset&apos;leri otomatik preview edilir.
                                            </div>
                                            <a
                                                href={ogImageUrl}
                                                target="_blank"
                                                rel="noreferrer"
                                                className="inline-flex rounded-full border border-border/70 bg-background px-3 py-1.5 text-[11px] font-semibold uppercase tracking-[0.16em] text-foreground transition hover:border-blue-500/40 hover:text-blue-600"
                                            >
                                                Gorseli yeni sekmede ac
                                            </a>
                                        </div>
                                    ) : (
                                        <div className="flex aspect-[1200/630] w-full items-center justify-center rounded-2xl border border-dashed border-border/70 bg-muted/40 text-center text-xs text-muted-foreground">
                                            OG gorseli girildiginde burada onizleme gorunur.
                                        </div>
                                    )}
                                    <div className="mt-3 rounded-2xl bg-background/90 p-3 backdrop-blur">
                                        <div className="truncate text-sm font-semibold text-foreground">
                                            {payload.settings.branding.defaultTitle}
                                        </div>
                                        <div className="mt-1 line-clamp-2 text-xs text-muted-foreground">
                                            {payload.settings.branding.defaultDescription}
                                        </div>
                                        <div className="mt-2 text-[11px] font-medium uppercase tracking-[0.16em] text-muted-foreground">
                                            Open Graph share preview
                                        </div>
                                    </div>
                                </div>
                            </div>
                        </div>

                        <div className="rounded-2xl border border-blue-500/20 bg-blue-500/5 px-4 py-4">
                            <div className="text-sm font-semibold text-foreground">Kisa Ogretici</div>
                            <div className="mt-3 space-y-2 text-sm text-muted-foreground">
                                {brandingGuide.map((item) => (
                                    <div key={item} className="flex gap-2">
                                        <span className="mt-1 h-1.5 w-1.5 rounded-full bg-blue-500" />
                                        <span>{item}</span>
                                    </div>
                                ))}
                                <div className="rounded-xl border border-border/70 bg-background px-3 py-3 text-xs text-muted-foreground">
                                    Root-relative yol (`/og-cover.png`) otomatik preview edilir. Tam URL kaydedilebilir ama guvenlik nedeniyle admin panelde otomatik yuklenmez.
                                </div>
                            </div>
                        </div>
                    </div>

                </CardContent>
            </Card>
            ) : null}

            {activeSection === "platform" ? (
            <Card className="border-border/70">
                <CardHeader>
                    <CardTitle className="flex items-center gap-2 text-xl"><SlidersHorizontal className="h-5 w-5" />Feature Gate&apos;ler</CardTitle>
                </CardHeader>
                <CardContent className="grid gap-3 md:grid-cols-2 xl:grid-cols-3">
                    <ToggleField checked={payload.settings.features.registrationsEnabled} label="Kayitlar Acik" description="Register endpoint&apos;ini acik veya kapali tutar." onChange={(checked) => updatePayload("features", "registrationsEnabled", checked)} />
                    <ToggleField checked={payload.settings.features.guestGameplayEnabled} label="Misafir Girisi" description="Guest create/join akisini kontrol eder." onChange={(checked) => updatePayload("features", "guestGameplayEnabled", checked)} />
                    <ToggleField checked={payload.settings.features.roomCreateEnabled} label="Oda Olusturma" description="Yeni lobi acma iznini kontrol eder." onChange={(checked) => updatePayload("features", "roomCreateEnabled", checked)} />
                    <ToggleField checked={payload.settings.features.roomJoinEnabled} label="Odaya Katilim" description="Mevcut odalara yeni oyuncu katilimini kontrol eder." onChange={(checked) => updatePayload("features", "roomJoinEnabled", checked)} />
                    <ToggleField checked={payload.settings.features.storeEnabled} label="Magaza Acik" description="Store catalog, purchase, bundle ve equip akisini kontrol eder." onChange={(checked) => updatePayload("features", "storeEnabled", checked)} />
                </CardContent>
            </Card>
            ) : null}

            {activeSection === "economy" ? (
            <Card className="border-border/70">
                <CardHeader>
                    <CardTitle className="text-xl">Ekonomi Temeli</CardTitle>
                </CardHeader>
                <CardContent className="space-y-5">
                    <div className="rounded-2xl border border-border/70 bg-muted/20 p-3">
                        <div className="grid gap-3 md:grid-cols-3">
                            {economyPanels.map((panel) => {
                                const isActive = activeEconomyPanel === panel.key;
                                return (
                                    <button
                                        key={panel.key}
                                        type="button"
                                        onClick={() => setActiveEconomyPanel(panel.key)}
                                        className={`rounded-2xl border px-4 py-4 text-left transition ${
                                            isActive
                                                ? "border-amber-500/40 bg-amber-500/10 shadow-[0_12px_40px_-24px_rgba(245,158,11,0.7)]"
                                                : "border-border/70 bg-background hover:border-amber-500/30 hover:bg-muted/30"
                                        }`}
                                    >
                                        <div className="text-sm font-semibold text-foreground">{panel.label}</div>
                                        <div className="mt-2 text-xs leading-5 text-muted-foreground">{panel.description}</div>
                                    </button>
                                );
                            })}
                        </div>
                    </div>

                    {activeEconomyPanel === "base" ? (
                        <div className="space-y-5">
                            <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-4">
                                <div className="space-y-2">
                                    <FieldLabel label="Baslangic Coin" helper="Yeni kayit olan kullanicinin wallet bakiyesi." />
                                    <input className={inputClassName} type="number" min="0" value={payload.settings.economy.startingCoinBalance} onChange={(event) => updatePayload("economy", "startingCoinBalance", Number(event.target.value))} />
                                </div>
                                <div className="space-y-2">
                                    <FieldLabel label="Galibiyet Odulu" helper="Mac kazanana verilecek baz coin. Ornek: 120 coin." />
                                    <input className={inputClassName} type="number" min="0" value={payload.settings.economy.winRewardCoin} onChange={(event) => updatePayload("economy", "winRewardCoin", Number(event.target.value))} />
                                </div>
                                <div className="space-y-2">
                                    <FieldLabel label="Maglubiyet Odulu" helper="Kaybeden oyuncuya verilecek baz coin. Ornek: 40 coin." />
                                    <input className={inputClassName} type="number" min="0" value={payload.settings.economy.lossRewardCoin} onChange={(event) => updatePayload("economy", "lossRewardCoin", Number(event.target.value))} />
                                </div>
                                <div className="space-y-2">
                                    <FieldLabel label="Beraberlik Odulu" helper="Mac berabere biterse verilecek baz coin. Ornek: 40 coin." />
                                    <input className={inputClassName} type="number" min="0" value={payload.settings.economy.drawRewardCoin} onChange={(event) => updatePayload("economy", "drawRewardCoin", Number(event.target.value))} />
                                </div>
                            </div>

                            <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
                                <div className="space-y-2">
                                    <FieldLabel label="Mac Coin Carpani" helper="Tum mac odullerine uygulanan global multiplier. Ornek: 1.25 ise 120 coin galibiyet odulu 150 olur." />
                                    <input className={inputClassName} type="number" min="0" max="10" step="0.1" value={payload.settings.economy.matchCoinMultiplier} onChange={(event) => updatePayload("economy", "matchCoinMultiplier", Number(event.target.value))} />
                                </div>
                                <div className="space-y-2">
                                    <FieldLabel label="Weekend Carpani" helper="Hafta sonu aktifse global carpana eklenir. Ornek: 1.5." />
                                    <input className={inputClassName} type="number" min="1" max="10" step="0.1" value={payload.settings.economy.weekendCoinMultiplier} onChange={(event) => updatePayload("economy", "weekendCoinMultiplier", Number(event.target.value))} />
                                </div>
                                <div className="space-y-2">
                                    <FieldLabel label="Magaza Fiyat Carpani" helper="Tum item ve bundle liste fiyatlarina runtime uygulanir. Ornek: 1.2 ise 500 coin item 600 gorunur." />
                                    <input className={inputClassName} type="number" min="0.1" max="10" step="0.1" value={payload.settings.economy.storePriceMultiplier} onChange={(event) => updatePayload("economy", "storePriceMultiplier", Number(event.target.value))} />
                                </div>
                            </div>

                            <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-4">
                                <ToggleField checked={payload.settings.economy.weekendCoinMultiplierEnabled} label="Weekend Boost" description="Cumartesi/Pazar odullerine ek multiplier uygular." onChange={(checked) => updatePayload("economy", "weekendCoinMultiplierEnabled", checked)} />
                                <ToggleField checked={payload.settings.economy.bundlesEnabled} label="Bundle Satislari" description="Bundle katalogu ve satin alma akislarini acar/kapatir." onChange={(checked) => updatePayload("economy", "bundlesEnabled", checked)} />
                                <ToggleField checked={payload.settings.economy.discountCampaignsEnabled} label="Kampanya Indirimleri" description="Discount campaign fiyat dusumlerini runtime kapatir/acar." onChange={(checked) => updatePayload("economy", "discountCampaignsEnabled", checked)} />
                                <ToggleField checked={payload.settings.economy.couponsEnabled} label="Kuponlar" description="Coupon preview ve coupon checkout davranisini acar/kapatir." onChange={(checked) => updatePayload("economy", "couponsEnabled", checked)} />
                            </div>
                        </div>
                    ) : null}

                    {activeEconomyPanel === "guard" ? (
                        <div className="space-y-4 rounded-2xl border border-border/70 bg-muted/20 p-4">
                            <div className="space-y-1">
                                <div className="text-sm font-semibold text-foreground">Odul Koruma Tavani</div>
                                <div className={helperClassName}>
                                    Bu katman captcha veya login guvenligiyle cakisma yaratmaz. Guvenlikte istek dogrulugu korunur; burada ise yalniz match reward pacing&apos;i kontrol edilir.
                                </div>
                            </div>

                            <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-4">
                                <ToggleField
                                    checked={payload.settings.economy.matchRewardGuardEnabled}
                                    label="Guard Aktif"
                                    description="Match reward icin rolling window bazli koruma katmanini acar."
                                    onChange={(checked) => updatePayload("economy", "matchRewardGuardEnabled", checked)}
                                />
                                <div className="space-y-2">
                                    <FieldLabel label="Window Saat" helper="Son kac saat icindeki match reward toplami izlenecek. Ornek: 24." />
                                    <input className={inputClassName} type="number" min="1" max="168" value={payload.settings.economy.matchRewardWindowHours} onChange={(event) => updatePayload("economy", "matchRewardWindowHours", Number(event.target.value))} />
                                </div>
                                <div className="space-y-2">
                                    <FieldLabel label="Soft Cap Coin" helper="Bu esikten sonra odul tam blok yerine kademeli dusmeye baslar. Ornek: 3000." />
                                    <input className={inputClassName} type="number" min="0" max="100000" value={payload.settings.economy.matchRewardSoftCapCoin} onChange={(event) => updatePayload("economy", "matchRewardSoftCapCoin", Number(event.target.value))} />
                                </div>
                                <div className="space-y-2">
                                    <FieldLabel label="Hard Ceiling Coin" helper="Cok uc farm davranisinda kullanilan ust emniyet tavani. Ornek: 5000." />
                                    <input className={inputClassName} type="number" min="0" max="100000" value={payload.settings.economy.matchRewardHardCapCoin} onChange={(event) => updatePayload("economy", "matchRewardHardCapCoin", Number(event.target.value))} />
                                </div>
                            </div>

                            <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
                                <div className="space-y-2">
                                    <FieldLabel label="Min Reward Multiplier" helper="Odul soft cap sonrasinda bu oranin altina dusmez. Ornek: 0.25 ise 120 coin odul en az 30 coin kalir." />
                                    <input className={inputClassName} type="number" min="0" max="1" step="0.05" value={payload.settings.economy.matchRewardMinMultiplier} onChange={(event) => updatePayload("economy", "matchRewardMinMultiplier", Number(event.target.value))} />
                                </div>
                                <div className="space-y-2">
                                    <FieldLabel label="Damping Profile" helper="Yuzdesel dususun hizini belirler." />
                                    <select className={inputClassName} value={payload.settings.economy.matchRewardDampingProfile} onChange={(event) => updatePayload("economy", "matchRewardDampingProfile", event.target.value as SystemSettingsResponse["settings"]["economy"]["matchRewardDampingProfile"])}>
                                        <option value="gentle">gentle</option>
                                        <option value="standard">standard</option>
                                        <option value="strict">strict</option>
                                    </select>
                                </div>
                                <div className="rounded-xl border border-border/70 bg-background px-4 py-3 text-sm text-muted-foreground">
                                    <div>
                                        <span className="font-semibold text-foreground">Rolling window:</span> gece yarisi reseti yerine son {payload.settings.economy.matchRewardWindowHours} saat izlenir.
                                    </div>
                                    <div className="mt-2">
                                        <span className="font-semibold text-foreground">Profil etkisi:</span> {dampingProfileExample[payload.settings.economy.matchRewardDampingProfile]}
                                    </div>
                                </div>
                            </div>
                        </div>
                    ) : null}

                    {activeEconomyPanel === "group" ? (
                        <div className="space-y-4 rounded-2xl border border-border/70 bg-muted/20 p-4">
                            <div className="space-y-1">
                                <div className="text-sm font-semibold text-foreground">Tekrar Eden Grup Korumasi</div>
                                <div className={helperClassName}>
                                    Ayni kucuk grubun kisa araliklarla surekli odullu mac oynamasi halinde verimi yumusak sekilde dusurmek icin kullanilir. Bu katman tek basina IP, subnet veya ayni ev bilgisini karar verici yapmaz.
                                </div>
                            </div>

                            <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-4">
                                <ToggleField
                                    checked={payload.settings.economy.repeatedGroupEnabled}
                                    label="Koruma Aktif"
                                    description="Ayni lineup tekrarlarinda reward damping uygular."
                                    onChange={(checked) => updatePayload("economy", "repeatedGroupEnabled", checked)}
                                />
                                <div className="space-y-2">
                                    <FieldLabel label="Window Saat" helper="Ayni grup tekrarini hangi pencere icinde izleyecegiz. Ornek: 12." />
                                    <input className={inputClassName} type="number" min="1" max="168" value={payload.settings.economy.repeatedGroupWindowHours} onChange={(event) => updatePayload("economy", "repeatedGroupWindowHours", Number(event.target.value))} />
                                </div>
                                <div className="space-y-2">
                                    <FieldLabel label="Tekrar Esigi" helper="Kac tekrar sonrasi damping baslayacagini belirler. Ornek: 6." />
                                    <input className={inputClassName} type="number" min="2" max="100" value={payload.settings.economy.repeatedGroupThreshold} onChange={(event) => updatePayload("economy", "repeatedGroupThreshold", Number(event.target.value))} />
                                </div>
                                <div className="space-y-2">
                                    <FieldLabel label="Min Group Multiplier" helper="Repeated-group damping odulu bu oranin altina dusurmez. Ornek: 0.40 ise 120 coin odul en az 48 coin kalir." />
                                    <input className={inputClassName} type="number" min="0" max="1" step="0.05" value={payload.settings.economy.repeatedGroupMinMultiplier} onChange={(event) => updatePayload("economy", "repeatedGroupMinMultiplier", Number(event.target.value))} />
                                </div>
                            </div>

                            <div className="rounded-xl border border-border/70 bg-background px-4 py-3 text-sm text-muted-foreground">
                                Ornek: dort kisilik ayni lineup ayni pencere icinde ust uste odullu mac yapiyorsa ilk maclar tam odul alir, esik asildikca odul yumusak sekilde azalir. Bu mekanik oyunu oynanmaz yapmak icin degil, organize farm davranisini anlamsizlastirmak icindir.
                            </div>
                        </div>
                    ) : null}

                    <div className="rounded-2xl border border-border/70 bg-muted/20 px-4 py-4 text-sm text-muted-foreground">
                        Canli sonuc ozeti:
                        <span className="ml-2 font-semibold text-foreground">
                            Mac multiplier x{payload.settings.economy.matchCoinMultiplier.toFixed(2)}
                        </span>
                        <span className="ml-4 font-semibold text-foreground">
                            Store multiplier x{payload.settings.economy.storePriceMultiplier.toFixed(2)}
                        </span>
                        {payload.settings.economy.weekendCoinMultiplierEnabled ? (
                            <span className="ml-4 font-semibold text-foreground">
                                Weekend x{payload.settings.economy.weekendCoinMultiplier.toFixed(2)}
                            </span>
                        ) : null}
                        {payload.settings.economy.matchRewardGuardEnabled ? (
                            <span className="ml-4 font-semibold text-foreground">
                                Guard {payload.settings.economy.matchRewardSoftCapCoin.toLocaleString("tr-TR")} / {payload.settings.economy.matchRewardHardCapCoin.toLocaleString("tr-TR")}
                            </span>
                        ) : null}
                    </div>
                </CardContent>
            </Card>
            ) : null}

            {activeSection === "capacity" ? (
                <div className="space-y-5">
                    <Card className="border-border/70">
                        <CardHeader>
                            <CardTitle className="flex items-center gap-2 text-xl">
                                <Gauge className="h-5 w-5" />
                                Oda ve Takım Kapasitesi
                            </CardTitle>
                        </CardHeader>
                        <CardContent className="space-y-5">
                            <div className="rounded-2xl border border-blue-500/20 bg-blue-500/5 px-4 py-4 text-sm leading-6 text-muted-foreground">
                                <p className="font-semibold text-foreground">Kod seviyesi güvenlik sınırı</p>
                                <p>
                                    Bir oda en fazla 20, bir takım en fazla 10 oyuncu alabilir.
                                    Buradaki değerleri düşürebilirsin; mevcut oyuncular atılmaz,
                                    yalnız yeni giriş ve takım geçişleri yeni sınıra göre kontrol edilir.
                                </p>
                            </div>

                            <div className="grid gap-4 md:grid-cols-2">
                                <div className="space-y-2">
                                    <FieldLabel
                                        label="Oda Başına Oyuncu"
                                        helper="İzleyiciler dahil toplam çevrimiçi kapasite. Önerilen başlangıç: 12."
                                    />
                                    <input
                                        className={inputClassName}
                                        type="number"
                                        min="4"
                                        max="20"
                                        value={payload.settings.capacity.roomMaxPlayers}
                                        onChange={(event) =>
                                            updatePayload("capacity", "roomMaxPlayers", Number(event.target.value))
                                        }
                                    />
                                </div>
                                <div className="space-y-2">
                                    <FieldLabel
                                        label="Takım Başına Oyuncu"
                                        helper="Aktif takım oyuncuları için sınır. İki takımın toplam kapasitesi oda sınırını karşılamalı; izleyiciler takım sayısına dahil değildir."
                                    />
                                    <input
                                        className={inputClassName}
                                        type="number"
                                        min="2"
                                        max="10"
                                        value={payload.settings.capacity.teamMaxPlayers}
                                        onChange={(event) =>
                                            updatePayload("capacity", "teamMaxPlayers", Number(event.target.value))
                                        }
                                    />
                                </div>
                            </div>

                            <div className="rounded-xl border border-border/70 bg-muted/20 px-4 py-3 text-sm leading-6 text-muted-foreground">
                                <span className="font-semibold text-foreground">Başlangıç kuralı:</span>{" "}
                                Kimlik türünden bağımsız minimum 4 aktif oyuncu gerekir.
                                Her iki takımda en az 2 oyuncu bulunmalı; izleyiciler sayılmaz.
                            </div>
                        </CardContent>
                    </Card>

                    <Card className="border-border/70">
                        <CardHeader>
                            <CardTitle className="text-xl">Sunucu Admission Kontrolü</CardTitle>
                        </CardHeader>
                        <CardContent className="space-y-5">
                            <div className="grid gap-4 md:grid-cols-3">
                                <div className="space-y-2">
                                    <FieldLabel
                                        label="Çalışma Modu"
                                        helper="Automatic eşiklere göre, Open zorla açık, Closed yeni işlemlere kapalıdır."
                                    />
                                    <select
                                        className={inputClassName}
                                        value={payload.settings.capacity.admissionMode}
                                        onChange={(event) =>
                                            updatePayload(
                                                "capacity",
                                                "admissionMode",
                                                event.target.value as SystemSettingsResponse["settings"]["capacity"]["admissionMode"]
                                            )
                                        }
                                    >
                                        <option value="automatic">Automatic</option>
                                        <option value="open">Open</option>
                                        <option value="closed">Closed</option>
                                    </select>
                                </div>
                                <div className="space-y-2">
                                    <FieldLabel
                                        label="Maksimum Aktif Oda"
                                        helper="Tüm canlı instance'ların Redis üzerinden toplanan oda sınırı."
                                    />
                                    <input
                                        className={inputClassName}
                                        type="number"
                                        min="1"
                                        max="100000"
                                        value={payload.settings.capacity.maxActiveRooms}
                                        onChange={(event) =>
                                            updatePayload("capacity", "maxActiveRooms", Number(event.target.value))
                                        }
                                    />
                                </div>
                                <div className="space-y-2">
                                    <FieldLabel
                                        label="Maksimum Online Oyuncu"
                                        helper="Tüm instance'ların toplam çevrimiçi oyuncu sınırı."
                                    />
                                    <input
                                        className={inputClassName}
                                        type="number"
                                        min="2"
                                        max="1000000"
                                        value={payload.settings.capacity.maxOnlinePlayers}
                                        onChange={(event) =>
                                            updatePayload("capacity", "maxOnlinePlayers", Number(event.target.value))
                                        }
                                    />
                                </div>
                            </div>

                            <div className="grid gap-4 md:grid-cols-2">
                                <div className="space-y-2">
                                    <FieldLabel
                                        label="Uyarı Eşiği (%)"
                                        helper="Bu seviyede panel uyarı verir, create/join açık kalır."
                                    />
                                    <input
                                        className={inputClassName}
                                        type="number"
                                        min="10"
                                        max="95"
                                        value={payload.settings.capacity.warningThresholdPercent}
                                        onChange={(event) =>
                                            updatePayload("capacity", "warningThresholdPercent", Number(event.target.value))
                                        }
                                    />
                                </div>
                                <div className="space-y-2">
                                    <FieldLabel
                                        label="Kritik Eşik (%)"
                                        helper="Automatic modda yeni oda oluşturma kapanır; mevcut odaya katılım kapasite dolana kadar sürer."
                                    />
                                    <input
                                        className={inputClassName}
                                        type="number"
                                        min="20"
                                        max="100"
                                        value={payload.settings.capacity.criticalThresholdPercent}
                                        onChange={(event) =>
                                            updatePayload("capacity", "criticalThresholdPercent", Number(event.target.value))
                                        }
                                    />
                                </div>
                            </div>

                            <div className="space-y-2">
                                <FieldLabel
                                    label="Yoğunluk Mesajı"
                                    helper="Yeni oda veya katılım geçici olarak engellendiğinde oyuncuya gösterilir."
                                />
                                <textarea
                                    className={`${inputClassName} min-h-24 resize-y`}
                                    value={payload.settings.capacity.capacityMessage}
                                    onChange={(event) =>
                                        updatePayload("capacity", "capacityMessage", event.target.value)
                                    }
                                />
                            </div>

                            <div className="rounded-xl border border-amber-500/20 bg-amber-500/5 px-4 py-3 text-sm leading-6 text-muted-foreground">
                                Reconnect istekleri admission durumundan bağımsız olarak önceliklidir.
                                Devam eden oyunlar durdurulmaz ve içerideki oyuncular yoğunluk nedeniyle atılmaz.
                            </div>
                        </CardContent>
                    </Card>
                </div>
            ) : null}

            {activeSection === "security" ? (
            <div className="space-y-5">
            <Card className="overflow-hidden border-teal-500/20">
                <CardHeader className="border-b border-border/70 bg-gradient-to-r from-teal-500/10 via-background to-amber-500/5">
                    <div className="flex flex-wrap items-center justify-between gap-3">
                        <div>
                            <CardTitle className="flex items-center gap-2 text-xl">
                                <ShieldCheck className="h-5 w-5 text-teal-600" />
                                E-posta Doğrulama
                            </CardTitle>
                            <p className="mt-2 max-w-3xl text-sm leading-6 text-muted-foreground">
                                Yeni hesapların doğrulama davranışını yönetir. Mevcut
                                doğrulanmamış hesaplar mod değişikliğinden geriye dönük
                                etkilenmez.
                            </p>
                        </div>
                        <ProviderBadge
                            enabled={payload.emailReadiness.configured}
                            label={`SMTP ${payload.emailReadiness.provider}`}
                        />
                    </div>
                </CardHeader>
                <CardContent className="space-y-5 pt-5">
                    <div className="grid gap-4 lg:grid-cols-[minmax(240px,0.7fr)_1.3fr]">
                        <div className="space-y-2">
                            <FieldLabel
                                label="Doğrulama Modu"
                                helper="Zorunlu mod yalnız bu ayar açıldıktan sonra kaydolan hesaplara uygulanır."
                            />
                            <select
                                className={inputClassName}
                                value={payload.settings.security.emailVerification.mode}
                                onChange={(event) =>
                                    updateEmailVerification(
                                        event.target.value as SystemSettingsResponse["settings"]["security"]["emailVerification"]["mode"]
                                    )
                                }
                            >
                                <option value="off">Kapalı</option>
                                <option value="optional">İsteğe bağlı</option>
                                <option
                                    value="required_for_new_accounts"
                                    disabled={!payload.emailReadiness.configured}
                                >
                                    Yeni hesaplarda zorunlu
                                </option>
                            </select>
                        </div>
                        <div className="grid gap-3 sm:grid-cols-3">
                            {[
                                {
                                    title: "Kapalı",
                                    text: "Doğrulama çağrısı ve gönderim kapalıdır.",
                                },
                                {
                                    title: "İsteğe bağlı",
                                    text: "Hesap hemen açılır; oyuncu Ayarlar'dan isterse doğrular.",
                                },
                                {
                                    title: "Zorunlu",
                                    text: "Yeni hesap pending açılır; doğrulanana kadar oda, mağaza mutasyonu ve ödül kapalıdır.",
                                },
                            ].map((item) => (
                                <div
                                    key={item.title}
                                    className="rounded-2xl border border-border/70 bg-muted/25 p-4"
                                >
                                    <div className="text-sm font-black text-foreground">
                                        {item.title}
                                    </div>
                                    <p className="mt-2 text-xs leading-5 text-muted-foreground">
                                        {item.text}
                                    </p>
                                </div>
                            ))}
                        </div>
                    </div>
                    {!payload.emailReadiness.configured ? (
                        <div className="rounded-2xl border border-amber-500/25 bg-amber-500/10 px-4 py-3 text-sm leading-6 text-amber-800 dark:text-amber-200">
                            Zorunlu mod kilitli. Önce `EMAIL_PROVIDER`, SMTP,
                            `NEXT_PUBLIC_SITE_URL`, `EMAIL_FROM` ve ayrı
                            `EMAIL_TOKEN_SECRET` yapılandırılmalı. Secret değerleri
                            admin panelinde saklanmaz.
                        </div>
                    ) : (
                        <div className="rounded-2xl border border-emerald-500/20 bg-emerald-500/10 px-4 py-3 text-sm leading-6 text-emerald-800 dark:text-emerald-200">
                            Provider hazır. Zorunlu kayıtta kullanıcı ve doğrulama
                            outbox kaydı aynı transaction içinde oluşturulur.
                        </div>
                    )}
                </CardContent>
            </Card>
            <Card className="border-border/70">
                <CardHeader>
                    <CardTitle className="flex items-center gap-2 text-xl"><ShieldCheck className="h-5 w-5" />Captcha Koruması</CardTitle>
                </CardHeader>
                <CardContent className="space-y-4">
                    <div className="flex flex-wrap gap-2">
                        <ProviderBadge enabled={payload.captchaReadiness.turnstileConfigured} label="Turnstile" />
                        <ProviderBadge enabled={payload.captchaReadiness.recaptchaConfigured} label="reCAPTCHA" />
                    </div>
                    <div className="rounded-2xl border border-border/70 bg-muted/30 px-4 py-3 text-sm text-muted-foreground">
                        <span className="font-semibold text-foreground">Aktif sağlayıcı:</span>{" "}
                        {payload.settings.security.captcha.provider === "recaptcha_v3" ? "reCAPTCHA v3" : "Turnstile"}
                        <span className="mx-2 text-border">|</span>
                        <span className="font-semibold text-foreground">Policy:</span>{" "}
                        {isProductionBuild
                            ? "Production: hata durumunda istek reddedilir"
                            : `Geliştirme: ${payload.settings.security.captcha.failMode}`}
                    </div>
                    <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-3">
                        <ToggleField checked={payload.settings.security.captcha.enabled} label="Captcha Aktif" description="Seçili akışlarda doğrulamayı açar. Kapalıyken hiçbir oyuncudan token istenmez." onChange={(checked) => updateCaptcha("enabled", checked)} />
                        <ToggleField checked={payload.settings.security.captcha.onRegister} label="Kayıtta Kullan" description="Otomatik hesap açma saldırılarını sınırlar. Açık tutulması önerilir." onChange={(checked) => updateCaptcha("onRegister", checked)} />
                        <ToggleField checked={payload.settings.security.captcha.onRoomCreate} label="Oda Oluşturmada Kullan" description="Örnek: botların seri oda oluşturmasını, rate limit ile birlikte sınırlar." onChange={(checked) => updateCaptcha("onRoomCreate", checked)} />
                        <ToggleField checked={payload.settings.security.captcha.onGuestJoin} label="Misafir Katılımında Kullan" description="Yoğun kötüye kullanımda açılabilir. Normal dönemde hızlı katılım için kapalı kalabilir." onChange={(checked) => updateCaptcha("onGuestJoin", checked)} />
                        <ToggleField checked={payload.settings.security.captcha.onLogin} label="Girişte Kullan" description="Şüpheli giriş dalgalarında ek katman sağlar; rate limit her zaman ayrı çalışır." onChange={(checked) => updateCaptcha("onLogin", checked)} />
                        {payload.settings.security.captcha.provider === "turnstile" && payload.settings.security.captcha.turnstileMode === "managed" ? (
                            <ToggleField checked={payload.settings.security.captcha.turnstileInteractiveFallback} label="Gerektiğinde Göster" description="Managed mod sessiz başlar; Cloudflare gerekli görürse oyuncuya etkileşimli doğrulama gösterir." onChange={(checked) => updateCaptcha("turnstileInteractiveFallback", checked)} />
                        ) : null}
                    </div>
                    <div className="grid gap-4 md:grid-cols-3">
                        <div className="space-y-2">
                            <FieldLabel label="Sağlayıcı" helper="Aynı anda yalnızca bir sağlayıcı aktif tutulur." />
                            <select className={inputClassName} value={payload.settings.security.captcha.provider} onChange={(event) => updateCaptcha("provider", event.target.value as SystemSettingsResponse["settings"]["security"]["captcha"]["provider"])}>
                                <option value="turnstile">Cloudflare Turnstile</option>
                                <option value="recaptcha_v3">Google reCAPTCHA v3</option>
                            </select>
                        </div>
                        {payload.settings.security.captcha.provider === "turnstile" ? (
                            <div className="space-y-2">
                                <FieldLabel label="Turnstile Modu" helper="Managed önerilir: normal oyuncu sessizce geçer, yalnız gerektiğinde doğrulama görünür." />
                                <select className={inputClassName} value={payload.settings.security.captcha.turnstileMode} onChange={(event) => updateCaptcha("turnstileMode", event.target.value as SystemSettingsResponse["settings"]["security"]["captcha"]["turnstileMode"])}>
                                    <option value="managed">Managed (Önerilen)</option>
                                    <option value="invisible">Invisible (Her zaman gizli)</option>
                                    <option value="non_interactive">Non-interactive</option>
                                </select>
                            </div>
                        ) : (
                            <div className="space-y-2">
                                <FieldLabel label="Sağlayıcı Politikası" helper="reCAPTCHA seçiliyken production ortamında hata durumunda istek reddedilir." />
                                <div className="rounded-xl border border-border/70 bg-muted/40 px-4 py-3 text-sm text-muted-foreground">
                                    Yedek sağlayıcıdır. Geçiş yalnızca operatör kararıyla yapılır.
                                </div>
                            </div>
                        )}
                        {payload.settings.security.captcha.provider === "recaptcha_v3" ? (
                            <div className="space-y-2">
                            <FieldLabel label="reCAPTCHA Skoru" helper="0 ile 1 arasında kabul eşiği. Bu ayar Turnstile için kullanılmaz." />
                            <input className={inputClassName} type="number" min="0" max="1" step="0.05" value={payload.settings.security.captcha.recaptchaScoreThreshold} onChange={(event) => updateCaptcha("recaptchaScoreThreshold", Number(event.target.value))} />
                            </div>
                        ) : (
                            <div className="space-y-2">
                                <FieldLabel label="Doğrulama Politikası" helper="Secret key sunucuda kalır; action ve production hostname sunucuda birebir doğrulanır." />
                                <div className="rounded-xl border border-border/70 bg-muted/40 px-4 py-3 text-sm text-muted-foreground">
                                    Ön hazırlık yalnız yapılandırma ve script yükler; token butona basılmadan üretilmez. Turnstile bir skor döndürmez.
                                </div>
                            </div>
                        )}
                    </div>
                </CardContent>
            </Card>
            </div>
            ) : null}
        </div>
    );
}







