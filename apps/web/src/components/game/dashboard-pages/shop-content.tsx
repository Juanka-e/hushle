"use client";

import { useEffect, useMemo, useState, type ReactNode } from "react";
import Link from "next/link";
import { useSession } from "next-auth/react";
import { toast } from "sonner";
import {
    BadgePercent,
    Check,
    CreditCard,
    Eye,
    Frame,
    Gift,
    Layers3,
    LoaderCircle,
    Search,
    ShoppingBag,
    Sparkles,
    TicketPercent,
    UserCircle,
    X,
} from "lucide-react";
import { CoinBadge, CoinMark } from "@/components/ui/coin-badge";
import {
    CosmeticLargePreview,
    CosmeticThumbnail,
} from "@/components/game/cosmetic-preview";
import { cn } from "@/lib/utils";
import {
    SHOP_RARITY_BADGE_CLASS,
    SHOP_RARITY_BUY_BUTTON_CLASS,
    SHOP_RARITY_CARD_CLASS,
    SHOP_RARITY_HALO_CLASS,
    SHOP_RARITY_TOP_STRIP_CLASS,
} from "@/lib/store/shop-admin";
import type {
    CatalogBundleView,
    CatalogStoreItemView,
    CouponCatalogPreviewResponse,
    StoreCatalogResponse,
    StoreItemType,
} from "@/types/economy";
import type { CoinGrantRedeemResult } from "@/types/coin-grants";
import { dispatchWalletUpdated } from "@/lib/wallet-events";
import { dispatchNotificationsUpdated } from "@/lib/notification-events";
import { useI18n } from "@/components/providers/i18n-provider";
import type { AppLocale } from "@/lib/i18n/config";

type ShopCategory = "all" | StoreItemType;
type BusyTarget = { kind: "shop_item" | "bundle"; id: number } | null;
type LayoutMode = "dashboard" | "page";
type UtilityMode = "coupon" | "coin_grant";
type PreviewOffer =
    | { kind: "item"; item: CatalogStoreItemView }
    | { kind: "bundle"; bundle: CatalogBundleView }
    | null;
type ActiveCouponPreview = Omit<CouponCatalogPreviewResponse, "coupon"> & {
    coupon: NonNullable<CouponCatalogPreviewResponse["coupon"]>;
};
type DisplayedPricing = {
    pricing: CatalogStoreItemView["pricing"] | CatalogBundleView["pricing"];
    coupon: ActiveCouponPreview["coupon"] | null;
    couponApplied: boolean;
    referencePriceCoin: number;
};

interface ShopContentProps {
    layout?: LayoutMode;
}

const COSMETIC_GRID_BATCH_SIZE = 24;

function createEmptyCatalog(): StoreCatalogResponse {
    return {
        coinBalance: 0,
        items: [],
        bundles: [],
        liveops: {
            bundlesEnabled: true,
            couponsEnabled: true,
            discountCampaignsEnabled: true,
            storePriceMultiplier: 1,
            activeMatchCoinMultiplier: 1,
            weekendBoostApplied: false,
        },
    };
}

function formatItemTypeLabel(type: StoreItemType, locale: AppLocale) {
    if (type === "avatar") return "Avatar";
    if (locale === "en") {
        if (type === "frame") return "Frame";
        if (type === "card_back") return "Card Back";
        return "Card Face";
    }
    if (type === "frame") return "Çerçeve";
    if (type === "card_back") return "Kart Arkası";
    return "Kart Önü";
}

type StoreFlagTone = "neutral" | "accent" | "warning" | "danger";

function getAvailabilityFlag(item: CatalogStoreItemView, locale: AppLocale) {
    const now = Date.now();
    const endsAtTime = item.endsAt ? new Date(item.endsAt).getTime() : null;

    if (item.availabilityMode === "event_only") {
        return { label: locale === "tr" ? "Etkinlik Özel" : "Event Exclusive", tone: "danger" as const };
    }

    if (endsAtTime && endsAtTime > now) {
        const hoursRemaining = (endsAtTime - now) / (1000 * 60 * 60);
        if (hoursRemaining <= 72) {
            return { label: locale === "tr" ? "Son Günler" : "Last Days", tone: "warning" as const };
        }
    }

    if (item.availabilityMode === "seasonal") {
        return { label: locale === "tr" ? "Sezonluk" : "Seasonal", tone: "accent" as const };
    }

    if (item.availabilityMode === "limited") {
        return { label: locale === "tr" ? "Sınırlı" : "Limited", tone: "warning" as const };
    }

    if (item.availabilityMode === "scheduled") {
        return { label: locale === "tr" ? "Süreli" : "Timed", tone: "neutral" as const };
    }

    return null;
}

function StoreFlag({
    label,
    tone = "neutral",
}: {
    label: string;
    tone?: StoreFlagTone;
}) {
    return (
        <span
            className={cn(
                "inline-flex rounded-full border px-2.5 py-1 text-[9px] font-black uppercase tracking-[0.16em]",
                tone === "accent" && "border-sky-200/80 bg-sky-50/80 text-sky-700 dark:border-sky-900/40 dark:bg-sky-950/25 dark:text-sky-300",
                tone === "warning" && "border-amber-200/80 bg-amber-50/80 text-amber-700 dark:border-amber-900/40 dark:bg-amber-950/25 dark:text-amber-300",
                tone === "danger" && "border-rose-200/80 bg-rose-50/80 text-rose-700 dark:border-rose-900/40 dark:bg-rose-950/25 dark:text-rose-300",
                tone === "neutral" && "border-white/60 bg-white/75 text-slate-700 dark:border-slate-700/70 dark:bg-slate-950/60 dark:text-slate-200"
            )}
        >
            {label}
        </span>
    );
}

export function ShopContent({ layout = "dashboard" }: ShopContentProps) {
    const { data: session } = useSession();
    const { locale, t } = useI18n();
    const categories: { id: ShopCategory; icon: typeof ShoppingBag; label: string }[] = [
        { id: "all", icon: ShoppingBag, label: t("shop.all") }, { id: "avatar", icon: UserCircle, label: t("shop.avatar") },
        { id: "frame", icon: Frame, label: t("shop.frame") }, { id: "card_back", icon: Layers3, label: t("shop.cardBack") },
        { id: "card_face", icon: Layers3, label: t("shop.cardFace") },
    ];
    const [category, setCategory] = useState<ShopCategory>("all");
    const [catalog, setCatalog] = useState<StoreCatalogResponse>(createEmptyCatalog);
    const [couponCode, setCouponCode] = useState("");
    const [coinGrantCode, setCoinGrantCode] = useState("");
    const [redeemingCoinGrant, setRedeemingCoinGrant] = useState(false);
    const [applyingCoupon, setApplyingCoupon] = useState(false);
    const [searchTerm, setSearchTerm] = useState("");
    const [busyTarget, setBusyTarget] = useState<BusyTarget>(null);
    const [previewOffer, setPreviewOffer] = useState<PreviewOffer>(null);
    const [utilityMode, setUtilityMode] = useState<UtilityMode>("coupon");
    const [activeCouponPreview, setActiveCouponPreview] = useState<ActiveCouponPreview | null>(null);
    const [visibleItemCount, setVisibleItemCount] = useState(COSMETIC_GRID_BATCH_SIZE);

    useEffect(() => {
        if (!session?.user) {
            return;
        }

        const load = async () => {
            try {
                const response = await fetch("/api/store/catalog", { cache: "no-store" });
                if (!response.ok) {
                    return;
                }
                const payload = (await response.json()) as StoreCatalogResponse;
                setCatalog(payload);
            } catch {
                // Keep previous catalog state.
            }
        };

        void load();
    }, [session]);

    const searchQuery = searchTerm.trim().toLocaleLowerCase(locale);

    const filteredItems = useMemo(() => {
        const categoryItems = category === "all"
            ? catalog.items
            : catalog.items.filter((item) => item.type === category);

        if (!searchQuery) {
            return categoryItems;
        }

        return categoryItems.filter((item) =>
            [item.name, item.code, item.badgeText ?? "", formatItemTypeLabel(item.type, locale)]
                .join(" ")
                .toLocaleLowerCase(locale)
                .includes(searchQuery)
        );
    }, [catalog.items, category, locale, searchQuery]);

    const filteredBundles = useMemo(() => {
        if (!searchQuery) {
            return catalog.bundles;
        }

        return catalog.bundles.filter((bundle) =>
            [bundle.name, bundle.code, bundle.description ?? "", ...bundle.items.map((entry) => entry.itemName)]
                .join(" ")
                .toLocaleLowerCase(locale)
                .includes(searchQuery)
        );
    }, [catalog.bundles, locale, searchQuery]);

    const featuredItems = useMemo(() => {
        const adminFeatured = filteredItems.filter((item) => item.isFeatured);
        if (adminFeatured.length > 0) {
            return adminFeatured.slice(0, 3);
        }
        const discounted = filteredItems.filter((item) => item.pricing.discountCoin > 0);
        return (discounted.length > 0 ? discounted : filteredItems).slice(0, 3);
    }, [filteredItems]);

    const catalogItemMap = useMemo(
        () => new Map(catalog.items.map((item) => [item.id, item])),
        [catalog.items]
    );

    const discountedOffers = useMemo(() => {
        const itemOffers = catalog.items
            .filter((item) => item.pricing.discountCoin > 0)
            .map((item) => ({ key: `item:${item.id}`, label: item.name, detail: `${item.pricing.discountCoin} coin indirim` }));
        const bundleOffers = catalog.bundles
            .filter((bundle) => bundle.pricing.discountCoin > 0)
            .map((bundle) => ({ key: `bundle:${bundle.id}`, label: bundle.name, detail: `${bundle.pricing.discountCoin} coin indirim` }));
        return [...itemOffers, ...bundleOffers].slice(0, 4);
    }, [catalog.bundles, catalog.items]);

    const busyKey = busyTarget ? `${busyTarget.kind}:${busyTarget.id}` : null;
    const trimmedCouponCode = couponCode.trim().toUpperCase();
    const appliedCouponCode = activeCouponPreview?.coupon.code ?? "";
    const hasAppliedCoupon = appliedCouponCode.length > 0 && appliedCouponCode === trimmedCouponCode;

    const activeCouponItemMap = useMemo(
        () => new Map((activeCouponPreview?.items ?? []).map((entry) => [entry.targetId, entry])),
        [activeCouponPreview]
    );
    const activeCouponBundleMap = useMemo(
        () => new Map((activeCouponPreview?.bundles ?? []).map((entry) => [entry.targetId, entry])),
        [activeCouponPreview]
    );
    const couponMatchedItems = useMemo(
        () => catalog.items.filter((item) => activeCouponItemMap.has(item.id)),
        [activeCouponItemMap, catalog.items]
    );
    const couponMatchedBundles = useMemo(
        () => catalog.bundles.filter((bundle) => activeCouponBundleMap.has(bundle.id)),
        [activeCouponBundleMap, catalog.bundles]
    );

    const getDisplayedItemPricing = (item: CatalogStoreItemView) => {
        const couponMatch = activeCouponItemMap.get(item.id);
        if (couponMatch && activeCouponPreview?.coupon) {
            return {
                pricing: couponMatch.pricing,
                coupon: activeCouponPreview.coupon,
                couponApplied: true,
                referencePriceCoin: item.pricing.finalPriceCoin,
            };
        }

        return {
            pricing: item.pricing,
            coupon: null,
            couponApplied: false,
            referencePriceCoin: item.pricing.basePriceCoin,
        };
    };

    const getDisplayedBundlePricing = (bundle: CatalogBundleView) => {
        const couponMatch = activeCouponBundleMap.get(bundle.id);
        if (couponMatch && activeCouponPreview?.coupon) {
            return {
                pricing: couponMatch.pricing,
                coupon: activeCouponPreview.coupon,
                couponApplied: true,
                referencePriceCoin: bundle.pricing.finalPriceCoin,
            };
        }

        return {
            pricing: bundle.pricing,
            coupon: null,
            couponApplied: false,
            referencePriceCoin: bundle.pricing.basePriceCoin,
        };
    };

    const sortedItems = useMemo(() => {
        if (!activeCouponPreview) {
            return filteredItems;
        }

        return [...filteredItems].sort((left, right) => {
            const leftMatch = activeCouponItemMap.has(left.id) ? 0 : 1;
            const rightMatch = activeCouponItemMap.has(right.id) ? 0 : 1;
            if (leftMatch !== rightMatch) {
                return leftMatch - rightMatch;
            }
            return left.sortOrder - right.sortOrder;
        });
    }, [activeCouponItemMap, activeCouponPreview, filteredItems]);

    useEffect(() => {
        setVisibleItemCount(COSMETIC_GRID_BATCH_SIZE);
    }, [category, searchQuery, activeCouponPreview]);

    const visibleItems = useMemo(
        () => sortedItems.slice(0, visibleItemCount),
        [sortedItems, visibleItemCount]
    );

    const applyOwnedItems = (awardedItemIds: number[], nextCoinBalance: number) => {
        const awardedSet = new Set(awardedItemIds);
        setCatalog((currentCatalog) => ({
            coinBalance: nextCoinBalance,
            items: currentCatalog.items.map((item) => (awardedSet.has(item.id) ? { ...item, owned: true } : item)),
            bundles: currentCatalog.bundles.map((bundle) => {
                const ownedItemCount = bundle.items.filter((entry) => awardedSet.has(entry.shopItemId)).length + bundle.ownedItemCount;
                return {
                    ...bundle,
                    ownedItemCount,
                    fullyOwned: ownedItemCount >= bundle.items.length && bundle.items.length > 0,
                };
            }),
            liveops: currentCatalog.liveops,
        }));
    };
    const handleBuyItem = async (item: CatalogStoreItemView) => {
        if (busyTarget || item.owned) {
            return;
        }
        setBusyTarget({ kind: "shop_item", id: item.id });
        try {
            const response = await fetch("/api/store/purchase", {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({
                    shopItemId: item.id,
                    couponCode: appliedCouponCode || undefined,
                }),
            });
            const payload = (await response.json()) as { coinBalance?: number; finalPriceCoin?: number; error?: string };
            if (!response.ok) {
                toast.error(payload.error || t("shop.purchaseFailed"));
                return;
            }

            applyOwnedItems([item.id], payload.coinBalance ?? catalog.coinBalance);
            if (payload.coinBalance !== undefined) {
                dispatchWalletUpdated({ coinBalance: payload.coinBalance, source: "store_purchase" });
            }
            dispatchNotificationsUpdated();
            toast.success(t("shop.purchased", { name: item.name }), {
                description: payload.finalPriceCoin !== undefined ? t("shop.coinSpent", { count: payload.finalPriceCoin }) : undefined,
            });
        } catch {
            toast.error(t("shop.purchaseRequestFailed"));
        } finally {
            setBusyTarget(null);
        }
    };

    const handleBuyBundle = async (bundle: CatalogBundleView) => {
        if (busyTarget || bundle.fullyOwned) {
            return;
        }
        setBusyTarget({ kind: "bundle", id: bundle.id });
        try {
            const response = await fetch("/api/store/bundles/purchase", {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({
                    bundleId: bundle.id,
                    couponCode: appliedCouponCode || undefined,
                }),
            });
            const payload = (await response.json()) as { awardedItems?: Array<{ id: number }>; coinBalance?: number; finalPriceCoin?: number; error?: string };
            if (!response.ok) {
                toast.error(payload.error || t("shop.bundlePurchaseFailed"));
                return;
            }

            const awardedItemIds = payload.awardedItems?.map((entry) => entry.id) ?? [];
            applyOwnedItems(awardedItemIds, payload.coinBalance ?? catalog.coinBalance);
            if (payload.coinBalance !== undefined) {
                dispatchWalletUpdated({ coinBalance: payload.coinBalance, source: "bundle_purchase" });
            }
            dispatchNotificationsUpdated();
            toast.success(t("shop.purchased", { name: bundle.name }), {
                description: payload.finalPriceCoin !== undefined ? t("shop.coinSpent", { count: payload.finalPriceCoin }) : undefined,
            });
        } catch {
            toast.error(t("shop.bundleRequestFailed"));
        } finally {
            setBusyTarget(null);
        }
    };

    const handleApplyCoupon = async () => {
        if (!trimmedCouponCode || applyingCoupon) {
            toast.info(t("shop.enterCoupon"));
            return;
        }
        setApplyingCoupon(true);
        try {
            const response = await fetch("/api/store/coupons/catalog-preview", {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({
                    couponCode: trimmedCouponCode,
                }),
            });
            const payload = (await response.json()) as CouponCatalogPreviewResponse | { error?: string };
            if (!response.ok || !("valid" in payload)) {
                setActiveCouponPreview(null);
                toast.error(("error" in payload && payload.error) ? payload.error : t("shop.couponInvalid"));
                return;
            }
            if (!payload.valid || !payload.coupon) {
                setActiveCouponPreview(null);
                toast.error(payload.reason || t("shop.couponNotApplicable"));
                return;
            }

            setActiveCouponPreview({
                valid: payload.valid,
                reason: payload.reason,
                coupon: payload.coupon,
                items: payload.items,
                bundles: payload.bundles,
            });
            toast.success(t("shop.couponApplied", { code: payload.coupon.code }), {
                description: t("shop.offersUpdated", { count: payload.items.length + payload.bundles.length }),
            });
        } catch {
            toast.error(t("shop.couponRequestFailed"));
        } finally {
            setApplyingCoupon(false);
        }
    };

    const handleRedeemCoinGrant = async () => {
        const trimmedCode = coinGrantCode.trim();
        if (!trimmedCode || redeemingCoinGrant) {
            return;
        }
        setRedeemingCoinGrant(true);
        try {
            const response = await fetch("/api/coin-grants/redeem", {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({ code: trimmedCode }),
            });
            const payload = (await response.json()) as CoinGrantRedeemResult | { error?: string };
            if (!response.ok || !("ok" in payload) || !payload.ok) {
                toast.error(("error" in payload && payload.error) ? payload.error : t("shop.coinCodeFailed"));
                return;
            }

            setCatalog((currentCatalog) => ({ ...currentCatalog, coinBalance: payload.coinBalance }));
            dispatchWalletUpdated({ coinBalance: payload.coinBalance, source: "coin_grant" });
            dispatchNotificationsUpdated();
            setCoinGrantCode("");
            toast.success(t("shop.coinCodeUsed"), {
                description: t("shop.coinAdded", { count: payload.coinAmount }),
            });
        } catch {
            toast.error(t("shop.coinCodeRequestFailed"));
        } finally {
            setRedeemingCoinGrant(false);
        }
    };

    const containerClassName = layout === "dashboard"
        ? "mx-auto flex w-full max-w-[1480px] flex-col px-4 py-5 md:px-6 md:py-6 xl:px-8"
        : "rounded-[28px] border border-zinc-200/70 bg-white/90 p-6 shadow-xl shadow-slate-200/40 backdrop-blur-sm dark:border-zinc-800/80 dark:bg-zinc-900/70";

    return (
        <div className={containerClassName}>
            <section className="mb-5 overflow-hidden rounded-[26px] border border-[#d5dee7] bg-[linear-gradient(135deg,#fdfdfd_0%,#f8fafc_58%,#eef4ff_100%)] shadow-[0_18px_48px_-40px_rgba(15,23,42,0.22)] dark:border-slate-800/80 dark:bg-[linear-gradient(135deg,#0f172a_0%,#111827_58%,#172554_100%)]">
                <div className="grid gap-4 p-4 md:p-5 xl:grid-cols-[minmax(0,1fr)_340px]">
                    <div>
                        <div className="mb-3 inline-flex items-center gap-2 rounded-full border border-slate-300/70 bg-white/80 px-3 py-1 text-[11px] font-black uppercase tracking-[0.2em] text-slate-700 dark:border-slate-700/70 dark:bg-slate-950/50 dark:text-slate-200">
                            <Sparkles className="h-3.5 w-3.5" />
                            {t("shop.title")}
                        </div>
                        <h1 className="max-w-2xl text-xl font-black tracking-tight text-slate-950 dark:text-white md:text-[1.75rem]">
                            {t("shop.catalog")}
                        </h1>
                        <p className="mt-2 max-w-xl text-sm leading-6 text-slate-600 dark:text-slate-300">
                            {t("shop.description")}
                        </p>
                        <div className="mt-3 flex flex-wrap gap-2">
                            <StatusChip label={t("shop.storeMultiplier", { value: catalog.liveops.storePriceMultiplier.toFixed(2) })} />
                            <StatusChip label={t("shop.matchMultiplier", { value: catalog.liveops.activeMatchCoinMultiplier.toFixed(2) })} />
                            {catalog.liveops.weekendBoostApplied ? <StatusChip label={t("shop.weekendBonus")} tone="warning" /> : null}
                            {!catalog.liveops.discountCampaignsEnabled ? <StatusChip label={t("shop.campaignsPaused")} tone="danger" /> : null}
                            <Link href="/checkout" className="inline-flex items-center gap-1.5 rounded-full border border-sky-200 bg-sky-50 px-3 py-1 text-[10px] font-black uppercase tracking-[0.16em] text-sky-700 transition hover:bg-sky-100 dark:border-sky-900/50 dark:bg-sky-950/35 dark:text-sky-300 dark:hover:bg-sky-950/60">
                                <CreditCard className="h-3.5 w-3.5" /> {t("shop.securePayment")}
                            </Link>
                        </div>
                        {discountedOffers.length > 0 ? (
                            <div className="mt-4 flex flex-wrap gap-2">
                                {discountedOffers.map((offer) => (
                                    <div key={offer.key} className="inline-flex items-center gap-2 rounded-full border border-emerald-200/80 bg-emerald-50/80 px-3 py-1 text-xs font-bold text-emerald-700 dark:border-emerald-900/40 dark:bg-emerald-950/25 dark:text-emerald-300">
                                        <BadgePercent className="h-3.5 w-3.5" />
                                        <span>{offer.label}</span>
                                        <span className="text-emerald-500">{offer.detail}</span>
                                    </div>
                                ))}
                            </div>
                        ) : null}
                    </div>
                    <div className="grid gap-3">
                        <CoinBadge value={catalog.coinBalance} label={t("shop.coinBalance")} className="rounded-[24px] border-amber-300/70 bg-white/90 px-4 py-4 dark:bg-slate-950/55" valueClassName="text-2xl" />
                        <div className="rounded-[24px] border border-slate-200/80 bg-white/90 p-4 shadow-sm dark:border-slate-800/70 dark:bg-slate-950/45">
                            <div className="flex flex-wrap items-center justify-between gap-2">
                                <div className="flex items-center gap-2 text-xs font-black uppercase tracking-[0.18em] text-slate-500 dark:text-slate-400">
                                    {utilityMode === "coupon" ? <TicketPercent className="h-3.5 w-3.5" /> : <Gift className="h-3.5 w-3.5" />}
                                    {utilityMode === "coupon" ? t("shop.coupon") : t("shop.coinCode")}
                                </div>
                                <div className="inline-flex rounded-full border border-slate-200 bg-slate-50 p-1 dark:border-slate-700 dark:bg-slate-900/70">
                                    <button
                                        type="button"
                                        onClick={() => setUtilityMode("coupon")}
                                        className={cn(
                                            "rounded-full px-3 py-1 text-[11px] font-black uppercase tracking-[0.16em] transition",
                                            utilityMode === "coupon"
                                                ? "bg-slate-950 text-white dark:bg-white dark:text-slate-950"
                                                : "text-slate-500 dark:text-slate-400"
                                        )}
                                    >
                                        {t("shop.coupon")}
                                    </button>
                                    <button
                                        type="button"
                                        onClick={() => setUtilityMode("coin_grant")}
                                        className={cn(
                                            "rounded-full px-3 py-1 text-[11px] font-black uppercase tracking-[0.16em] transition",
                                            utilityMode === "coin_grant"
                                                ? "bg-slate-950 text-white dark:bg-white dark:text-slate-950"
                                                : "text-slate-500 dark:text-slate-400"
                                        )}
                                    >
                                        {t("shop.coinCode")}
                                    </button>
                                </div>
                            </div>
                            <div className="mt-3 space-y-3">
                                {utilityMode === "coupon" ? (
                                    <>
                                        <div className="flex gap-2">
                                            <input
                                                value={couponCode}
                                                onChange={(event) => {
                                                    const nextValue = event.target.value.toUpperCase();
                                                    setCouponCode(nextValue);
                                                    if (!nextValue.trim() || (activeCouponPreview && activeCouponPreview.coupon.code !== nextValue.trim())) {
                                                        setActiveCouponPreview(null);
                                                    }
                                                }}
                                                placeholder="WELCOME25"
                                                disabled={!catalog.liveops.couponsEnabled}
                                                className={cn(
                                                    "min-w-0 flex-1 rounded-2xl border bg-white px-3 py-2.5 text-sm font-semibold uppercase tracking-[0.12em] text-slate-700 outline-none transition dark:bg-slate-950 dark:text-slate-100",
                                                    hasAppliedCoupon
                                                        ? "border-emerald-300 focus:border-emerald-500 dark:border-emerald-800/60"
                                                        : "border-slate-200 focus:border-slate-500 dark:border-slate-700"
                                                )}
                                            />
                                            <button
                                                type="button"
                                                onClick={() => void handleApplyCoupon()}
                                                disabled={!trimmedCouponCode || !catalog.liveops.couponsEnabled || applyingCoupon}
                                                className={cn(
                                                    "inline-flex min-w-[112px] items-center justify-center gap-2 rounded-2xl px-3 py-2.5 text-xs font-bold transition disabled:opacity-50",
                                                    applyingCoupon
                                                        ? "border border-slate-300 bg-slate-100 text-slate-700 dark:border-slate-700 dark:bg-slate-900 dark:text-slate-200"
                                                        : "",
                                                    hasAppliedCoupon
                                                        ? "border border-emerald-300 bg-emerald-500 text-white shadow-[0_12px_28px_-18px_rgba(16,185,129,0.9)] hover:bg-emerald-600 dark:border-emerald-500/40 dark:bg-emerald-500 dark:text-white"
                                                        : "border border-blue-200 bg-blue-50 text-blue-700 hover:border-blue-300 hover:bg-blue-100 dark:border-blue-900/40 dark:bg-blue-950/30 dark:text-blue-300"
                                                )}
                                            >
                                                {applyingCoupon ? <LoaderCircle className="h-3.5 w-3.5 animate-spin" /> : hasAppliedCoupon ? <Check className="h-3.5 w-3.5" /> : <TicketPercent className="h-3.5 w-3.5" />}
                                                {applyingCoupon ? t("shop.checking") : hasAppliedCoupon ? t("shop.applied") : t("shop.use")}
                                            </button>
                                        </div>
                                        <p className="text-xs leading-5 text-slate-500 dark:text-slate-400">
                                            {t("shop.couponHelp")}
                                        </p>
                                        <div className="flex flex-wrap items-center gap-2 text-xs">
                                            {activeCouponPreview ? (
                                                <span className="rounded-full border border-blue-200 bg-blue-50 px-3 py-1 font-bold text-blue-700 dark:border-blue-900/40 dark:bg-blue-950/30 dark:text-blue-300">
                                                    {t("shop.activeCouponMeta", { code: activeCouponPreview.coupon.code, count: activeCouponPreview.items.length + activeCouponPreview.bundles.length })}
                                                </span>
                                            ) : null}
                                        </div>
                                    </>
                                ) : (
                                    <>
                                        <div className="flex gap-2">
                                            <input
                                                value={coinGrantCode}
                                                onChange={(event) => setCoinGrantCode(event.target.value.toUpperCase())}
                                                onKeyDown={(event) => {
                                                    if (event.key === "Enter") {
                                                        event.preventDefault();
                                                        void handleRedeemCoinGrant();
                                                    }
                                                }}
                                                placeholder="CREATOR-AB12CD"
                                                maxLength={80}
                                                className="min-w-0 flex-1 rounded-2xl border border-slate-200 bg-white px-3 py-2.5 text-sm font-semibold uppercase tracking-[0.12em] text-slate-700 outline-none transition focus:border-amber-500 dark:border-slate-700 dark:bg-slate-950 dark:text-slate-100"
                                            />
                                            <button
                                                type="button"
                                                onClick={() => void handleRedeemCoinGrant()}
                                                disabled={redeemingCoinGrant || !coinGrantCode.trim()}
                                                className="rounded-2xl border border-amber-200 bg-amber-50 px-3 py-2.5 text-xs font-bold text-amber-700 transition hover:border-amber-300 hover:bg-amber-100 disabled:opacity-50 dark:border-amber-900/40 dark:bg-amber-950/30 dark:text-amber-300"
                                            >
                                                {redeemingCoinGrant ? "..." : t("shop.use")}
                                            </button>
                                        </div>
                                        <p className="text-xs leading-5 text-slate-500 dark:text-slate-400">
                                            {t("shop.coinCodeHelp")}
                                        </p>
                                    </>
                                )}
                            </div>
                        </div>
                    </div>
                </div>
            </section>

            <div className="mb-5 flex flex-wrap gap-2">
                {categories.map((shopCategory) => {
                    const Icon = shopCategory.icon;
                    const active = category === shopCategory.id;
                    return (
                        <button key={shopCategory.id} type="button" onClick={() => setCategory(shopCategory.id)} className={cn("inline-flex items-center gap-2 rounded-full border px-4 py-2 text-xs font-black uppercase tracking-[0.18em] transition-all", active ? "border-slate-950 bg-slate-950 text-white dark:border-white dark:bg-white dark:text-slate-950" : "border-slate-200 bg-white text-slate-600 hover:border-slate-300 hover:text-slate-900 dark:border-slate-800 dark:bg-slate-950/40 dark:text-slate-300 dark:hover:bg-slate-900")}><Icon className="h-3.5 w-3.5" />{shopCategory.label}</button>
                    );
                })}
            </div>

            {activeCouponPreview && (couponMatchedItems.length > 0 || couponMatchedBundles.length > 0) ? (
                <section className="mb-8 rounded-[24px] border border-blue-200/80 bg-blue-50/70 p-4 dark:border-blue-900/30 dark:bg-blue-950/20">
                    <div className="flex flex-wrap items-center justify-between gap-3">
                        <div>
                            <div className="text-[11px] font-black uppercase tracking-[0.2em] text-blue-700 dark:text-blue-300">
                                {t("shop.activeCoupon")}
                            </div>
                            <h2 className="mt-1 text-lg font-black text-slate-900 dark:text-white">{activeCouponPreview.coupon.code}</h2>
                            <p className="mt-1 text-sm text-slate-600 dark:text-slate-300">
                                {t("shop.activeCouponHelp")}
                            </p>
                        </div>
                        <div className="flex flex-wrap gap-2 text-xs font-bold">
                            <span className="rounded-full border border-blue-200 bg-white/80 px-3 py-1 text-blue-700 dark:border-blue-800/60 dark:bg-slate-950/50 dark:text-blue-300">
                                {t("shop.itemCount", { count: couponMatchedItems.length })}
                            </span>
                            <span className="rounded-full border border-blue-200 bg-white/80 px-3 py-1 text-blue-700 dark:border-blue-800/60 dark:bg-slate-950/50 dark:text-blue-300">
                                {t("shop.bundleCount", { count: couponMatchedBundles.length })}
                            </span>
                        </div>
                    </div>
                </section>
            ) : null}

            {featuredItems.length > 0 ? (
                <section className="mb-8">
                    <div className="mb-4 flex items-end justify-between gap-4">
                        <div>
                            <h2 className="text-xl font-black tracking-tight text-slate-900 dark:text-white">{t("shop.featured")}</h2>
                            <p className="mt-1 text-sm text-slate-500 dark:text-slate-400">{t("shop.featuredHelp")}</p>
                        </div>
                    </div>
                    <div className="grid gap-4 lg:grid-cols-3">
                        {featuredItems.map((item) => (
                            <FeatureCard key={item.id} item={item} activePricing={getDisplayedItemPricing(item)} busy={busyKey === `shop_item:${item.id}`} onPreview={() => setPreviewOffer({ kind: "item", item })} onBuy={() => void handleBuyItem(item)} />
                        ))}
                    </div>
                </section>
            ) : null}

            <section className="mb-8 rounded-[28px] border border-slate-200/80 bg-white/85 p-5 shadow-[0_20px_60px_-40px_rgba(15,23,42,0.2)] dark:border-slate-800/70 dark:bg-slate-950/40 md:p-6">
                <div className="mb-5 flex items-center justify-between gap-4">
                    <div>
                        <h2 className="text-xl font-black tracking-tight text-slate-900 dark:text-white">{t("shop.products")}</h2>
                        <p className="mt-1 text-sm text-slate-500 dark:text-slate-400">{t("shop.productsHelp")}</p>
                    </div>
                    <div className="rounded-full bg-slate-100 px-3 py-1 text-xs font-bold uppercase tracking-[0.18em] text-slate-600 dark:bg-slate-900 dark:text-slate-300">{t("shop.itemCount", { count: filteredItems.length })}</div>
                </div>
                <div className="mb-5 flex flex-col gap-3 md:flex-row md:items-center md:justify-between">
                    <div className="relative w-full max-w-md">
                        <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-400" />
                        <input
                            value={searchTerm}
                            onChange={(event) => setSearchTerm(event.target.value)}
                            placeholder={t("shop.search")}
                            className="w-full rounded-2xl border border-slate-200 bg-white py-2.5 pl-10 pr-4 text-sm font-medium text-slate-700 outline-none transition focus:border-slate-400 dark:border-slate-700 dark:bg-slate-950/50 dark:text-slate-100"
                        />
                    </div>
                    {searchQuery ? (
                        <div className="text-xs font-bold uppercase tracking-[0.16em] text-slate-500 dark:text-slate-400">
                            {t("shop.searchValue", { value: searchTerm })}
                        </div>
                    ) : null}
                </div>
                {filteredItems.length === 0 ? (
                    <div className="rounded-[22px] border border-dashed border-slate-300/70 px-6 py-10 text-center text-sm text-slate-500 dark:border-slate-700/70 dark:text-slate-400">{searchQuery ? t("shop.noSearchItems") : t("shop.noActiveItems")}</div>
                ) : (
                    <div className="space-y-5">
                        <div className="grid grid-cols-2 gap-3 md:grid-cols-3 2xl:grid-cols-4">
                            {visibleItems.map((item) => (
                                <MerchItemCard key={item.id} item={item} activePricing={getDisplayedItemPricing(item)} busy={busyKey === `shop_item:${item.id}`} onPreview={() => setPreviewOffer({ kind: "item", item })} onBuy={() => void handleBuyItem(item)} />
                            ))}
                        </div>
                        {visibleItems.length < sortedItems.length ? (
                            <div className="flex flex-col items-center justify-center gap-2">
                                <button
                                    type="button"
                                    onClick={() => setVisibleItemCount((current) => current + COSMETIC_GRID_BATCH_SIZE)}
                                    className="rounded-2xl border border-slate-200 bg-white px-5 py-2.5 text-xs font-black uppercase tracking-[0.16em] text-slate-700 transition hover:border-slate-300 hover:bg-slate-50 dark:border-slate-700 dark:bg-slate-950/60 dark:text-slate-200 dark:hover:bg-slate-900"
                                >
                                    {t("shop.showMore")}
                                </button>
                                <span className="text-xs font-medium text-slate-500 dark:text-slate-400">
                                    {t("shop.showing", { visible: visibleItems.length, total: sortedItems.length })}
                                </span>
                            </div>
                        ) : null}
                    </div>
                )}
            </section>

            <section className="rounded-[28px] border border-slate-200/80 bg-white/85 p-5 shadow-[0_20px_60px_-40px_rgba(15,23,42,0.2)] dark:border-slate-800/70 dark:bg-slate-950/40 md:p-6">
                <div className="mb-5 flex items-center justify-between gap-4">
                    <div>
                        <h2 className="text-xl font-black tracking-tight text-slate-900 dark:text-white">{t("shop.bundles")}</h2>
                        <p className="mt-1 text-sm text-slate-500 dark:text-slate-400">{t("shop.bundlesHelp")}</p>
                    </div>
                    <div className="rounded-full bg-slate-100 px-3 py-1 text-xs font-bold uppercase tracking-[0.18em] text-slate-600 dark:bg-slate-900 dark:text-slate-300">{t("shop.bundleCount", { count: filteredBundles.length })}</div>
                </div>
                {filteredBundles.length === 0 ? (
                    <div className="rounded-[22px] border border-dashed border-slate-300/70 px-6 py-10 text-center text-sm text-slate-500 dark:border-slate-700/70 dark:text-slate-400">{catalog.liveops.bundlesEnabled ? (searchQuery ? t("shop.noSearchBundles") : t("shop.noBundles")) : t("shop.bundlesPaused")}</div>
                ) : (
                    <div className="grid gap-4 xl:grid-cols-2">
                        {filteredBundles.map((bundle) => (
                            <BundleMerchCard key={bundle.id} bundle={bundle} activePricing={getDisplayedBundlePricing(bundle)} itemLookup={catalogItemMap} busy={busyKey === `bundle:${bundle.id}`} onPreview={() => setPreviewOffer({ kind: "bundle", bundle })} onBuy={() => void handleBuyBundle(bundle)} />
                        ))}
                    </div>
                )}
            </section>

            {previewOffer ? <PreviewModal offer={previewOffer} itemLookup={catalogItemMap} getDisplayedItemPricing={getDisplayedItemPricing} getDisplayedBundlePricing={getDisplayedBundlePricing} onClose={() => setPreviewOffer(null)} onBuyItem={handleBuyItem} onBuyBundle={handleBuyBundle} busyKey={busyKey} /> : null}
        </div>
    );
}

function StatusChip({ label, tone = "neutral" }: { label: string; tone?: "neutral" | "warning" | "danger" }) {
    return <div className={cn("inline-flex items-center rounded-full border px-3 py-1 text-[11px] font-bold uppercase tracking-[0.16em]", tone === "warning" && "border-amber-300/80 bg-amber-50/80 text-amber-700 dark:border-amber-900/50 dark:bg-amber-950/25 dark:text-amber-300", tone === "danger" && "border-rose-300/80 bg-rose-50/80 text-rose-700 dark:border-rose-900/50 dark:bg-rose-950/25 dark:text-rose-300", tone === "neutral" && "border-slate-200/80 bg-white/80 text-slate-600 dark:border-slate-700/70 dark:bg-slate-950/40 dark:text-slate-300")}>{label}</div>;
}

function FeatureCard({ item, activePricing, busy, onPreview, onBuy }: { item: CatalogStoreItemView; activePricing: DisplayedPricing; busy: boolean; onPreview: () => void; onBuy: () => void }) {
    const { locale, t } = useI18n();
    const availabilityFlag = getAvailabilityFlag(item, locale);

    return (
        <article className={cn("group relative overflow-hidden rounded-[30px] border p-5 shadow-[0_24px_60px_-40px_rgba(15,23,42,0.28)] transition-all hover:-translate-y-1 hover:shadow-[0_28px_70px_-42px_rgba(15,23,42,0.32)]", SHOP_RARITY_CARD_CLASS[item.rarity], SHOP_RARITY_HALO_CLASS[item.rarity])}>
            <div className={cn("absolute inset-x-5 top-0 h-1.5 rounded-b-full opacity-90", SHOP_RARITY_TOP_STRIP_CLASS[item.rarity])} />
            <div className="relative z-10">
                <div className="flex items-start justify-between gap-3">
                    <div className="min-w-0">
                        <div className="flex flex-wrap items-center gap-2">
                            <span className="rounded-full border border-white/60 bg-white/75 px-2.5 py-1 text-[9px] font-black uppercase tracking-[0.16em] text-slate-700 dark:border-slate-700/70 dark:bg-slate-950/60 dark:text-slate-200">
                                {item.isFeatured ? t("shop.featured") : formatItemTypeLabel(item.type, locale)}
                            </span>
                            {availabilityFlag ? <StoreFlag label={availabilityFlag.label} tone={availabilityFlag.tone} /> : null}
                            {item.badgeText ? <span className="rounded-full border border-amber-200/80 bg-amber-50/80 px-2.5 py-1 text-[9px] font-black uppercase tracking-[0.16em] text-amber-700 dark:border-amber-900/40 dark:bg-amber-950/25 dark:text-amber-300">{item.badgeText}</span> : null}
                        </div>
                        <h3 className="mt-3 text-xl font-black tracking-tight text-slate-900 dark:text-white">{item.name}</h3>
                        <p className="mt-1 text-sm text-slate-500 dark:text-slate-400">{formatItemTypeLabel(item.type, locale)}</p>
                    </div>
                    <span className={`rounded-full px-2.5 py-1 text-[10px] font-black uppercase tracking-[0.18em] ${SHOP_RARITY_BADGE_CLASS[item.rarity]}`}>{item.rarity}</span>
                </div>

                <div className="mt-5 flex items-center justify-center rounded-[24px] border border-white/60 bg-[radial-gradient(circle_at_top,_rgba(255,255,255,0.55),_transparent_58%),linear-gradient(180deg,rgba(255,255,255,0.82),rgba(241,245,249,0.78))] p-5 dark:border-slate-700/60 dark:bg-[radial-gradient(circle_at_top,_rgba(255,255,255,0.08),_transparent_58%),linear-gradient(180deg,rgba(30,41,59,0.72),rgba(15,23,42,0.82))]">
                    <CosmeticThumbnail item={item} />
                </div>

                <div className="mt-5 flex items-end justify-between gap-4">
                    <div className="min-w-0">
                        <div className="text-[11px] font-black uppercase tracking-[0.18em] text-slate-500 dark:text-slate-400">{t("shop.price")}</div>
                        {(activePricing.couponApplied || activePricing.pricing.discountCoin > 0) ? <div className="mt-1 text-xs text-slate-400 line-through">{activePricing.referencePriceCoin.toLocaleString()} coin</div> : null}
                        <div className="mt-1 flex items-center gap-2 text-2xl font-black text-slate-900 dark:text-white">
                            {activePricing.pricing.finalPriceCoin.toLocaleString()}
                            <CoinMark className="h-7 w-7" iconClassName="h-3.5 w-3.5" />
                        </div>
                        {activePricing.couponApplied ? <div className="mt-2 inline-flex rounded-full border border-blue-200 bg-blue-50 px-2.5 py-1 text-[10px] font-black uppercase tracking-[0.16em] text-blue-700 dark:border-blue-900/40 dark:bg-blue-950/30 dark:text-blue-300">{activePricing.coupon?.code}</div> : null}
                    </div>
                </div>

                <div className="mt-5 flex flex-wrap gap-2">
                    <ActionButton icon={<Eye className="h-3.5 w-3.5" />} label={t("shop.preview")} onClick={onPreview} />
                    <BuyButton item={item} busy={busy} onClick={onBuy} />
                </div>
            </div>
        </article>
    );
}
function MerchItemCard({ item, activePricing, busy, onPreview, onBuy }: { item: CatalogStoreItemView; activePricing: DisplayedPricing; busy: boolean; onPreview: () => void; onBuy: () => void }) {
    const { locale, t } = useI18n();
    const availabilityFlag = getAvailabilityFlag(item, locale);

    return (
        <article className={cn("group relative overflow-hidden rounded-[26px] border p-3.5 transition-all hover:-translate-y-0.5 hover:shadow-[0_22px_44px_-34px_rgba(15,23,42,0.25)]", SHOP_RARITY_CARD_CLASS[item.rarity], SHOP_RARITY_HALO_CLASS[item.rarity])}>
            <div className={cn("absolute inset-x-4 top-0 h-1.5 rounded-b-full opacity-85", SHOP_RARITY_TOP_STRIP_CLASS[item.rarity])} />
            <div className="relative z-10">
                <div className="mb-3 flex aspect-[0.95/1] items-center justify-center rounded-[20px] border border-white/40 bg-[radial-gradient(circle_at_top,_rgba(255,255,255,0.48),_transparent_55%),linear-gradient(180deg,rgba(248,250,252,0.95),rgba(226,232,240,0.85))] p-4 dark:border-white/10 dark:bg-[radial-gradient(circle_at_top,_rgba(255,255,255,0.08),_transparent_55%),linear-gradient(180deg,rgba(30,41,59,0.82),rgba(15,23,42,0.92))]">
                    <CosmeticThumbnail item={item} />
                </div>
                <div className="flex items-start justify-between gap-3">
                    <div className="min-w-0">
                        <div className="flex flex-wrap items-center gap-2">
                            <p className="text-[10px] font-black uppercase tracking-[0.16em] text-slate-500 dark:text-slate-400">{formatItemTypeLabel(item.type, locale)}</p>
                            {availabilityFlag ? <StoreFlag label={availabilityFlag.label} tone={availabilityFlag.tone} /> : null}
                            {item.badgeText ? <span className="rounded-full border border-amber-200/80 bg-amber-50/80 px-2 py-0.5 text-[9px] font-black uppercase tracking-[0.14em] text-amber-700 dark:border-amber-900/40 dark:bg-amber-950/25 dark:text-amber-300">{item.badgeText}</span> : null}
                        </div>
                        <h3 className="mt-2 truncate text-sm font-black text-slate-900 dark:text-white">{item.name}</h3>
                    </div>
                    <span className={`rounded-full px-2 py-0.5 text-[10px] font-bold uppercase ${SHOP_RARITY_BADGE_CLASS[item.rarity]}`}>{item.rarity}</span>
                </div>
                <div className="mt-3 flex items-end justify-between gap-3">
                    <div>
                        {(activePricing.couponApplied || activePricing.pricing.discountCoin > 0) ? <div className="text-[11px] text-slate-400 line-through">{activePricing.referencePriceCoin.toLocaleString()}</div> : null}
                        <div className="mt-0.5 flex items-center gap-1 text-sm font-black text-slate-900 dark:text-white">
                            {activePricing.pricing.finalPriceCoin.toLocaleString()}
                            <CoinMark className="h-4 w-4 ring-0 shadow-none" iconClassName="h-2.5 w-2.5" />
                        </div>
                        {activePricing.couponApplied ? <div className="mt-1 text-[10px] font-black uppercase tracking-[0.16em] text-blue-600 dark:text-blue-300">{activePricing.coupon?.code}</div> : null}
                    </div>
                    <ActionIconButton icon={<Eye className="h-3.5 w-3.5" />} label={t("shop.preview")} onClick={onPreview} />
                </div>
                <div className="mt-3"><BuyButton item={item} busy={busy} onClick={onBuy} fullWidth /></div>
            </div>
        </article>
    );
}

function BundleMerchCard({ bundle, activePricing, itemLookup, busy, onPreview, onBuy }: { bundle: CatalogBundleView; activePricing: DisplayedPricing; itemLookup: Map<number, CatalogStoreItemView>; busy: boolean; onPreview: () => void; onBuy: () => void }) {
    const { locale, t } = useI18n();
    const disabled = busy || bundle.fullyOwned || bundle.ownedItemCount > 0;
    return (
        <article className="rounded-[28px] border border-slate-200/80 bg-[linear-gradient(135deg,rgba(255,255,255,0.94),rgba(248,250,252,0.9),rgba(240,249,255,0.88))] p-5 shadow-[0_24px_56px_-40px_rgba(15,23,42,0.24)] dark:border-slate-800/70 dark:bg-[linear-gradient(135deg,rgba(15,23,42,0.82),rgba(17,24,39,0.82),rgba(30,41,59,0.78))]">
            <div className="flex items-start justify-between gap-4">
                <div className="min-w-0">
                    <div className="flex flex-wrap items-center gap-2">
                        <div className="inline-flex rounded-full bg-slate-950 px-3 py-1 text-[10px] font-black uppercase tracking-[0.18em] text-white dark:bg-slate-100 dark:text-slate-950">{t("shop.bundle")}</div>
                        <div className="rounded-full border border-white/70 bg-white/75 px-3 py-1 text-[10px] font-black uppercase tracking-[0.16em] text-slate-600 dark:border-slate-700/70 dark:bg-slate-950/60 dark:text-slate-300">{t("shop.pieces", { count: bundle.items.length })}</div>
                        {activePricing.couponApplied ? <div className="inline-flex rounded-full border border-blue-200 bg-blue-50 px-3 py-1 text-[10px] font-black uppercase tracking-[0.16em] text-blue-700 dark:border-blue-900/40 dark:bg-blue-950/30 dark:text-blue-300">{activePricing.coupon?.code}</div> : null}
                    </div>
                    <h3 className="mt-3 text-2xl font-black tracking-tight text-slate-900 dark:text-white">{bundle.name}</h3>
                    <p className="mt-2 max-w-2xl text-sm leading-6 text-slate-500 dark:text-slate-400">{bundle.description}</p>
                </div>
                <CoinBadge value={activePricing.pricing.finalPriceCoin} label={t("shop.bundlePrice")} className="min-w-[140px] rounded-[20px] px-3 py-2" valueClassName="text-base" />
            </div>
            <div className="mt-6 grid grid-cols-2 gap-3 sm:grid-cols-4">
                {bundle.items.slice(0, 4).map((item) => {
                    const catalogItem = itemLookup.get(item.shopItemId);
                    return (
                        <div key={item.id} className={`rounded-[22px] border p-3 shadow-sm ${SHOP_RARITY_CARD_CLASS[item.itemRarity]}`}>
                            <div className="flex justify-center">
                                {catalogItem ? <CosmeticThumbnail item={catalogItem} /> : <div className="flex h-20 w-20 items-center justify-center rounded-[20px] bg-slate-900 text-sm font-black text-white">{item.itemName.slice(0, 1).toUpperCase()}</div>}
                            </div>
                            <div className="mt-3 text-center">
                                <div className="text-[10px] font-black uppercase tracking-[0.16em] text-slate-500 dark:text-slate-400">{formatItemTypeLabel(item.itemType, locale)}</div>
                                <div className="mt-1 truncate text-sm font-black text-slate-900 dark:text-white">{item.itemName}</div>
                            </div>
                        </div>
                    );
                })}
            </div>
            <div className="mt-6 flex flex-col gap-3 lg:flex-row lg:items-center lg:justify-between">
                <div>
                    {(activePricing.couponApplied || activePricing.pricing.discountCoin > 0) ? <div className="text-sm text-slate-400 line-through">{activePricing.referencePriceCoin.toLocaleString()} coin</div> : null}
                    <div className="mt-1 text-sm font-semibold text-slate-600 dark:text-slate-300">{bundle.ownedItemCount > 0 ? t("shop.alreadyOwn", { count: bundle.ownedItemCount }) : t("shop.cosmeticsIncluded", { count: bundle.items.length })}</div>
                </div>
                <div className="flex flex-wrap items-center gap-2">
                    <ActionButton icon={<Eye className="h-3.5 w-3.5" />} label={t("shop.preview")} onClick={onPreview} />
                    <button type="button" onClick={onBuy} disabled={disabled} className="rounded-2xl bg-slate-950 px-4 py-2 text-xs font-black uppercase tracking-[0.16em] text-white transition hover:bg-slate-800 disabled:opacity-50 dark:bg-white dark:text-slate-950 dark:hover:bg-slate-200">{bundle.fullyOwned ? t("shop.owned") : bundle.ownedItemCount > 0 ? t("shop.ownedItemInBundle") : busy ? t("shop.buying") : t("shop.buyBundle")}</button>
                </div>
            </div>
        </article>
    );
}

function ActionButton({ icon, label, onClick, disabled = false }: { icon: ReactNode; label: string; onClick: () => void; disabled?: boolean }) {
    return <button type="button" onClick={onClick} disabled={disabled} className="inline-flex items-center gap-2 rounded-2xl border border-slate-200 bg-white px-3 py-2 text-xs font-black uppercase tracking-[0.16em] text-slate-700 transition hover:bg-slate-50 disabled:opacity-50 dark:border-slate-700 dark:bg-slate-950/50 dark:text-slate-200 dark:hover:bg-slate-900">{icon}{label}</button>;
}

function ActionIconButton({ icon, label, onClick, disabled = false }: { icon: ReactNode; label: string; onClick: () => void; disabled?: boolean }) {
    return <button type="button" onClick={onClick} disabled={disabled} aria-label={label} className="inline-flex h-9 w-9 items-center justify-center rounded-xl border border-slate-200 bg-white text-slate-700 transition hover:bg-slate-50 disabled:opacity-50 dark:border-slate-700 dark:bg-slate-950/50 dark:text-slate-200 dark:hover:bg-slate-900">{icon}</button>;
}

function BuyButton({ item, busy, onClick, fullWidth = false }: { item: CatalogStoreItemView; busy: boolean; onClick: () => void; fullWidth?: boolean }) {
    const { t } = useI18n();
    const label = item.equipped ? t("shop.inUse") : item.owned ? t("shop.owned") : busy ? t("shop.buying") : t("shop.buy");
    const className = item.owned ? (item.equipped ? "bg-blue-600 text-white" : "bg-emerald-600 text-white") : SHOP_RARITY_BUY_BUTTON_CLASS[item.rarity];
    return <button type="button" onClick={onClick} disabled={busy || item.owned} className={cn("rounded-2xl px-4 py-2 text-xs font-black uppercase tracking-[0.16em] transition-all disabled:opacity-50", fullWidth && "w-full", className)}>{label}</button>;
}
function PreviewModal({ offer, itemLookup, getDisplayedItemPricing, getDisplayedBundlePricing, onClose, onBuyItem, onBuyBundle, busyKey }: { offer: PreviewOffer; itemLookup: Map<number, CatalogStoreItemView>; getDisplayedItemPricing: (item: CatalogStoreItemView) => DisplayedPricing; getDisplayedBundlePricing: (bundle: CatalogBundleView) => DisplayedPricing; onClose: () => void; onBuyItem: (item: CatalogStoreItemView) => void; onBuyBundle: (bundle: CatalogBundleView) => void; busyKey: string | null }) {
    if (!offer) return null;
    return (
        <div className="fixed inset-0 z-[90] flex items-center justify-center bg-slate-950/70 px-4 py-6 backdrop-blur-sm" onClick={onClose}>
            <div className="relative max-h-[90vh] w-full max-w-4xl overflow-y-auto rounded-[32px] border border-white/10 bg-[linear-gradient(135deg,rgba(255,255,255,0.98),rgba(244,247,251,0.98),rgba(238,244,255,0.98))] p-5 shadow-[0_32px_90px_-50px_rgba(15,23,42,0.8)] dark:border-slate-800 dark:bg-[linear-gradient(135deg,rgba(15,23,42,0.96),rgba(17,24,39,0.96),rgba(23,37,84,0.95))] md:p-6" onClick={(event) => event.stopPropagation()}>
                <button type="button" onClick={onClose} className="absolute right-4 top-4 inline-flex h-10 w-10 items-center justify-center rounded-full border border-slate-200 bg-white text-slate-700 transition hover:bg-slate-50 dark:border-slate-700 dark:bg-slate-950/60 dark:text-slate-200 dark:hover:bg-slate-900"><X className="h-4 w-4" /></button>
                {offer.kind === "item" ? <ItemPreviewContent item={offer.item} activePricing={getDisplayedItemPricing(offer.item)} busy={busyKey === `shop_item:${offer.item.id}`} onBuy={() => void onBuyItem(offer.item)} /> : <BundlePreviewContent bundle={offer.bundle} activePricing={getDisplayedBundlePricing(offer.bundle)} itemLookup={itemLookup} busy={busyKey === `bundle:${offer.bundle.id}`} onBuy={() => void onBuyBundle(offer.bundle)} />}
            </div>
        </div>
    );
}

function ItemPreviewContent({ item, activePricing, busy, onBuy }: { item: CatalogStoreItemView; activePricing: DisplayedPricing; busy: boolean; onBuy: () => void }) {
    const { locale, t } = useI18n();
    const availabilityFlag = getAvailabilityFlag(item, locale);

    return (
        <div className="grid gap-6 lg:grid-cols-[minmax(0,1fr)_320px]">
            <div className="rounded-[28px] border border-slate-200/80 bg-[radial-gradient(circle_at_top,_rgba(255,255,255,0.6),_transparent_60%),linear-gradient(180deg,rgba(248,250,252,0.96),rgba(226,232,240,0.9))] p-5 dark:border-slate-800/70 dark:bg-[radial-gradient(circle_at_top,_rgba(255,255,255,0.08),_transparent_60%),linear-gradient(180deg,rgba(17,24,39,0.96),rgba(2,6,23,0.96))]"><CosmeticLargePreview item={item} /></div>
            <div className="flex flex-col rounded-[28px] border border-slate-200/80 bg-white/90 p-5 dark:border-slate-800/70 dark:bg-slate-950/45">
                <div className="flex items-start justify-between gap-4">
                    <div>
                        <div className="text-[11px] font-black uppercase tracking-[0.2em] text-slate-500 dark:text-slate-400">{t("shop.itemPreview")}</div>
                        <h3 className="mt-2 text-3xl font-black tracking-tight text-slate-900 dark:text-white">{item.name}</h3>
                        <p className="mt-2 text-sm text-slate-500 dark:text-slate-400">{formatItemTypeLabel(item.type, locale)} • {item.rarity}</p>
                        <div className="mt-3 flex flex-wrap gap-2">
                            {availabilityFlag ? <StoreFlag label={availabilityFlag.label} tone={availabilityFlag.tone} /> : null}
                            {item.badgeText ? <StoreFlag label={item.badgeText} tone="warning" /> : null}
                        </div>
                    </div>
                    <span className={`rounded-full px-2.5 py-1 text-[10px] font-black uppercase tracking-[0.18em] ${SHOP_RARITY_BADGE_CLASS[item.rarity]}`}>{item.rarity}</span>
                </div>
                {item.pricing.appliedPromotion ? <div className="mt-4 rounded-2xl border border-emerald-200/80 bg-emerald-50/80 px-3 py-2 text-sm font-medium text-emerald-700 dark:border-emerald-900/40 dark:bg-emerald-950/30 dark:text-emerald-300">{t("shop.campaign", { name: item.pricing.appliedPromotion.name })}</div> : null}
                <div className="mt-6"><div className="text-sm text-slate-400 dark:text-slate-500">{t("shop.price")}</div>{(activePricing.couponApplied || activePricing.pricing.discountCoin > 0) ? <div className="mt-1 text-sm text-slate-400 line-through">{activePricing.referencePriceCoin.toLocaleString()} coin</div> : null}<div className="mt-2 flex items-center gap-2 text-3xl font-black text-slate-900 dark:text-white">{activePricing.pricing.finalPriceCoin.toLocaleString()}<CoinMark className="h-9 w-9" iconClassName="h-4 w-4" /></div>{activePricing.couponApplied ? <div className="mt-2 inline-flex rounded-full border border-blue-200 bg-blue-50 px-3 py-1 text-[10px] font-black uppercase tracking-[0.18em] text-blue-700 dark:border-blue-900/40 dark:bg-blue-950/30 dark:text-blue-300">{activePricing.coupon?.code}</div> : null}</div>
                <div className="mt-auto flex flex-wrap gap-2 pt-6"><BuyButton item={item} busy={busy} onClick={onBuy} /></div>
            </div>
        </div>
    );
}

function BundlePreviewContent({ bundle, activePricing, itemLookup, busy, onBuy }: { bundle: CatalogBundleView; activePricing: DisplayedPricing; itemLookup: Map<number, CatalogStoreItemView>; busy: boolean; onBuy: () => void }) {
    const { locale, t } = useI18n();
    const disabled = busy || bundle.fullyOwned || bundle.ownedItemCount > 0;
    return (
        <div className="grid gap-6 lg:grid-cols-[minmax(0,1fr)_320px]">
            <div className="rounded-[28px] border border-slate-200/80 bg-[radial-gradient(circle_at_top,_rgba(255,255,255,0.6),_transparent_60%),linear-gradient(180deg,rgba(248,250,252,0.96),rgba(226,232,240,0.9))] p-5 dark:border-slate-800/70 dark:bg-[radial-gradient(circle_at_top,_rgba(255,255,255,0.08),_transparent_60%),linear-gradient(180deg,rgba(17,24,39,0.96),rgba(2,6,23,0.96))]">
                <div className="grid grid-cols-2 gap-4">{bundle.items.map((item) => { const catalogItem = itemLookup.get(item.shopItemId); return (<div key={item.id} className={`rounded-[22px] border p-4 text-center ${SHOP_RARITY_CARD_CLASS[item.itemRarity]}`}><div className="flex justify-center">{catalogItem ? <CosmeticThumbnail item={catalogItem} /> : <div className="flex h-20 w-20 items-center justify-center rounded-[20px] bg-slate-900 text-sm font-black text-white">{item.itemName.slice(0, 1).toUpperCase()}</div>}</div><div className="mt-3 text-[10px] font-black uppercase tracking-[0.18em] text-slate-500 dark:text-slate-400">{formatItemTypeLabel(item.itemType, locale)}</div><div className="mt-1 text-sm font-black text-slate-900 dark:text-white">{item.itemName}</div></div>); })}</div>
            </div>
            <div className="flex flex-col rounded-[28px] border border-slate-200/80 bg-white/90 p-5 dark:border-slate-800/70 dark:bg-slate-950/45">
                <div className="text-[11px] font-black uppercase tracking-[0.2em] text-slate-500 dark:text-slate-400">{t("shop.bundlePreview")}</div><h3 className="mt-2 text-3xl font-black tracking-tight text-slate-900 dark:text-white">{bundle.name}</h3><p className="mt-3 text-sm leading-6 text-slate-500 dark:text-slate-400">{bundle.description}</p>
                <div className="mt-6"><div className="text-sm text-slate-400 dark:text-slate-500">{t("shop.price")}</div>{(activePricing.couponApplied || activePricing.pricing.discountCoin > 0) ? <div className="mt-1 text-sm text-slate-400 line-through">{activePricing.referencePriceCoin.toLocaleString()} coin</div> : null}<div className="mt-2 flex items-center gap-2 text-3xl font-black text-slate-900 dark:text-white">{activePricing.pricing.finalPriceCoin.toLocaleString()}<CoinMark className="h-9 w-9" iconClassName="h-4 w-4" /></div>{activePricing.couponApplied ? <div className="mt-2 inline-flex rounded-full border border-blue-200 bg-blue-50 px-3 py-1 text-[10px] font-black uppercase tracking-[0.18em] text-blue-700 dark:border-blue-900/40 dark:bg-blue-950/30 dark:text-blue-300">{activePricing.coupon?.code}</div> : null}<div className="mt-2 text-sm font-semibold text-slate-600 dark:text-slate-300">{bundle.ownedItemCount > 0 ? t("shop.alreadyOwn", { count: bundle.ownedItemCount }) : t("shop.cosmeticsIncluded", { count: bundle.items.length })}</div></div>
                <div className="mt-auto flex flex-wrap gap-2 pt-6"><button type="button" onClick={onBuy} disabled={disabled} className="rounded-2xl bg-slate-950 px-4 py-2 text-xs font-black uppercase tracking-[0.16em] text-white transition hover:bg-slate-800 disabled:opacity-50 dark:bg-white dark:text-slate-950 dark:hover:bg-slate-200">{bundle.fullyOwned ? t("shop.owned") : bundle.ownedItemCount > 0 ? t("shop.ownedItemInBundle") : busy ? t("shop.buying") : t("shop.buyBundle")}</button></div>
            </div>
        </div>
    );
}
