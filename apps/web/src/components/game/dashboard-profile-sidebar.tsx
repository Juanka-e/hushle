"use client";

import Image from "next/image";
import { useEffect, useMemo, useState } from "react";
import { useSession } from "next-auth/react";
import { ArrowUpRight, Plus, Sparkles, UserRound } from "lucide-react";
import { CosmeticThumbnail, formatCosmeticTypeLabel } from "@/components/game/cosmetic-preview";
import { CoinMark } from "@/components/ui/coin-badge";
import { WALLET_UPDATED_EVENT } from "@/lib/wallet-events";
import { INVENTORY_UPDATED_EVENT } from "@/lib/inventory-events";
import { resolveFrameTheme } from "@/lib/cosmetics/frame";
import { buildCosmeticPatternStyle, getCosmeticMotionClass, getCosmeticMotionStyle } from "@/lib/cosmetics/effects";
import type {
  CatalogStoreItemView,
  DashboardDataResponse,
  InventoryItemView,
  StoreCatalogResponse,
  UserInventoryResponse,
} from "@/types/economy";
import type { DashboardTab } from "./dashboard-nav";
import { useI18n } from "@/components/providers/i18n-provider";

interface ProfileSidebarProps {
  onTabChange: (tab: DashboardTab) => void;
  mode?: "sidebar" | "inline";
}

interface SidebarState {
  displayName: string;
  avatarImageUrl: string | null;
  coinBalance: number;
  totalMatches: number;
  winRate: number;
  equippedItems: InventoryItemView[];
}


function sortStoreItemsByPriority(items: CatalogStoreItemView[]): CatalogStoreItemView[] {
  return [...items].sort((left, right) => {
    if (left.sortOrder !== right.sortOrder) {
      return left.sortOrder - right.sortOrder;
    }

    return new Date(right.createdAt).getTime() - new Date(left.createdAt).getTime();
  });
}

function buildDiscoveryRail(items: CatalogStoreItemView[]): CatalogStoreItemView[] {
  const unownedItems = items.filter((item) => !item.owned);
  if (unownedItems.length === 0) {
    return [];
  }

  const featuredItems = sortStoreItemsByPriority(unownedItems.filter((item) => item.isFeatured));
  if (featuredItems.length > 0) {
    return featuredItems.slice(0, 4);
  }

  const discountedItems = sortStoreItemsByPriority(
    unownedItems.filter((item) => item.pricing.discountCoin > 0)
  );
  if (discountedItems.length > 0) {
    return discountedItems.slice(0, 4);
  }

  return sortStoreItemsByPriority(unownedItems).slice(0, 4);
}

export function DashboardProfileSidebar({ onTabChange, mode = "sidebar" }: ProfileSidebarProps) {
  const { data: session } = useSession();
  const { t } = useI18n();
  const [profile, setProfile] = useState<SidebarState | null>(null);
  const [profileLoaded, setProfileLoaded] = useState(false);
  const [discoveryItems, setDiscoveryItems] = useState<CatalogStoreItemView[]>([]);

  useEffect(() => {
    if (!session?.user) {
      return;
    }

    const loadProfile = async () => {
      try {
        const [dashboardResponse, inventoryResponse] = await Promise.all([
          fetch("/api/user/dashboard", { cache: "no-store" }),
          fetch("/api/user/me", { cache: "no-store" }),
        ]);

        if (!dashboardResponse.ok || !inventoryResponse.ok) {
          return;
        }

        const dashboard = (await dashboardResponse.json()) as DashboardDataResponse;
        const inventory = (await inventoryResponse.json()) as UserInventoryResponse;

        setProfile({
          displayName: inventory.profile.displayName || inventory.name || session.user.name || "Player",
          avatarImageUrl:
            inventory.items.find((item) => item.equipped && item.type === "avatar")?.imageUrl || null,
          coinBalance: dashboard.coinBalance,
          totalMatches: dashboard.totalMatches,
          winRate: dashboard.winRate,
          equippedItems: inventory.items.filter((item) => item.equipped),
        });
      } catch {
        // Sidebar can render fallback values.
      } finally {
        setProfileLoaded(true);
      }
    };

    const loadDiscovery = async () => {
      try {
        const catalogResponse = await fetch("/api/store/catalog", { cache: "no-store" });
        if (!catalogResponse.ok) {
          return;
        }

        const catalog = (await catalogResponse.json()) as StoreCatalogResponse;
        setDiscoveryItems(buildDiscoveryRail(catalog.items));
      } catch {
        // Keep previous discovery items on failure.
      }
    };

    void Promise.all([loadProfile(), loadDiscovery()]);

    const handleWalletUpdated = () => {
      void loadProfile();
    };

    const handleInventoryUpdated = () => {
      void Promise.all([loadProfile(), loadDiscovery()]);
    };

    const handleDisplayNameUpdated = (event: Event) => {
      const nextDisplayName =
        event instanceof CustomEvent && typeof event.detail?.displayName === "string"
          ? event.detail.displayName
          : window.localStorage.getItem("tabu_username") || session.user.name || "Player";

      setProfile((current) =>
        current
          ? {
              ...current,
              displayName: nextDisplayName,
            }
          : {
              displayName: nextDisplayName,
              avatarImageUrl: null,
              coinBalance: 0,
              totalMatches: 0,
              winRate: 0,
              equippedItems: [],
            }
      );
    };

    window.addEventListener(WALLET_UPDATED_EVENT, handleWalletUpdated);
    window.addEventListener(INVENTORY_UPDATED_EVENT, handleInventoryUpdated);
    window.addEventListener("tabu:display-name-updated", handleDisplayNameUpdated);
    return () => {
      window.removeEventListener(WALLET_UPDATED_EVENT, handleWalletUpdated);
      window.removeEventListener(INVENTORY_UPDATED_EVENT, handleInventoryUpdated);
      window.removeEventListener("tabu:display-name-updated", handleDisplayNameUpdated);
    };
  }, [session]);

  const name = profile?.displayName || session?.user?.name || "Player";
  const quickEquipItems = useMemo(() => (profile?.equippedItems ?? []).slice(0, 3), [profile?.equippedItems]);
  const equippedFrame = useMemo(
    () => profile?.equippedItems.find((item) => item.type === "frame") ?? null,
    [profile?.equippedItems]
  );
  const discoveryLeadItem = discoveryItems[0] ?? null;
  const discoverySecondaryItems = useMemo(() => discoveryItems.slice(1, 4), [discoveryItems]);

  if (mode === "inline") {
    return (
      <div className="space-y-3 border-b border-slate-200/60 bg-white/72 px-4 py-3.5 backdrop-blur-xl dark:border-slate-800/70 dark:bg-slate-950/35 xl:hidden">
        <QuickEquipPanel items={quickEquipItems} onOpenInventory={() => onTabChange("inventory")} compact />
      </div>
    );
  }

  return (
    <aside className="hidden h-full min-w-[300px] w-[320px] flex-col overflow-y-auto border-l border-slate-200/60 bg-white/55 backdrop-blur-xl dark:border-slate-800/70 dark:bg-slate-950/35 xl:flex 2xl:w-[340px]">
      <div className="flex flex-1 flex-col p-6 text-center">
        <div className="rounded-[28px] border border-white/60 bg-white/80 p-6 shadow-[0_20px_60px_-40px_rgba(15,23,42,0.45)] dark:border-slate-800/70 dark:bg-slate-950/55">
          <div className="group relative mb-4 mx-auto w-fit cursor-pointer transition-transform hover:scale-[1.02]">
            <ProfileAvatarFrame avatarImageUrl={profile?.avatarImageUrl ?? null} frameItem={equippedFrame} profileLoaded={profileLoaded} />
          </div>

          <h2 className="text-xl font-black text-slate-800 dark:text-white">{name}</h2>
          <p className="mb-6 text-xs font-black uppercase tracking-[0.2em] text-blue-500 dark:text-blue-400">
            {t("profile.matchesPlayed", { count: profile?.totalMatches ?? 0 })}
          </p>

          <div className="mb-6 w-full rounded-[24px] border border-slate-200/60 bg-slate-100/60 p-4 dark:border-slate-800/70 dark:bg-slate-900/70">
            <div className="grid grid-cols-2 gap-3">
              <div className="rounded-[20px] border border-slate-200/50 bg-white/80 p-3 dark:border-slate-800/70 dark:bg-slate-950/70">
                <div className="text-[10px] font-black uppercase tracking-[0.18em] text-slate-500 dark:text-slate-400">
                  {t("profile.winRate")}
                </div>
                <div className="text-lg font-black text-slate-800 dark:text-white">{profile?.winRate ?? 0}%</div>
              </div>
              <div className="rounded-[20px] border border-slate-200/50 bg-white/80 p-3 dark:border-slate-800/70 dark:bg-slate-950/70">
                <div className="text-[10px] font-black uppercase tracking-[0.18em] text-slate-500 dark:text-slate-400">
                  Coin
                </div>
                <div className="flex items-center justify-center gap-1 text-lg font-black text-slate-800 dark:text-white">
                  {profile?.coinBalance ?? 0}
                  <CoinMark className="h-5 w-5 ring-0 shadow-none" iconClassName="h-3 w-3" />
                </div>
              </div>
            </div>
          </div>

          <QuickEquipPanel items={quickEquipItems} onOpenInventory={() => onTabChange("inventory")} />

          <DiscoveryStripPanel
            discoveryItems={discoveryItems}
            leadItem={discoveryLeadItem}
            secondaryItems={discoverySecondaryItems}
            onOpenShop={() => onTabChange("shop")}
          />
        </div>
      </div>

      <div className="mt-auto border-t border-slate-200/60 bg-slate-50/60 p-6 dark:border-slate-800/70 dark:bg-slate-950/45">
        <div className="flex items-center justify-between text-xs text-slate-500">
          <span>{t("profile.panelAccess")}</span>
          <span className="font-semibold text-slate-700 dark:text-slate-300">{t("profile.accessModes")}</span>
        </div>
      </div>
    </aside>
  );
}

function QuickEquipPanel({
  items,
  onOpenInventory,
  compact = false,
}: {
  items: InventoryItemView[];
  onOpenInventory: () => void;
  compact?: boolean;
}) {
  const { locale, t } = useI18n();
  return (
    <div className={`w-full text-left ${compact ? "" : "mb-8"}`}>
      <div className={`flex items-center justify-between gap-3 ${compact ? "mb-3" : "mb-4"}`}>
      <h3 className="text-xs font-black uppercase tracking-[0.22em] text-slate-500 dark:text-slate-400">
        {t("profile.quickEquip")}
      </h3>
      {compact ? (
        <span className="text-[11px] font-semibold text-slate-400 dark:text-slate-500">
          {t("profile.quickEquipHelp")}
        </span>
      ) : null}
      </div>
      <div className={compact ? "grid grid-cols-4 gap-2" : "grid grid-cols-4 gap-2.5"}>
        {items.map((item) => (
          <button
            key={item.inventoryItemId}
            onClick={onOpenInventory}
            className={`ring-indigo-400 flex items-center justify-center overflow-hidden rounded-[22px] border border-white/70 bg-[radial-gradient(circle_at_top,_rgba(255,255,255,0.58),_transparent_55%),linear-gradient(180deg,rgba(248,250,252,0.98),rgba(226,232,240,0.9))] p-1 shadow-[0_10px_30px_-18px_rgba(15,23,42,0.45)] transition-all hover:-translate-y-0.5 hover:ring-2 dark:border-slate-700/70 dark:bg-[radial-gradient(circle_at_top,_rgba(255,255,255,0.1),_transparent_55%),linear-gradient(180deg,rgba(30,41,59,0.88),rgba(15,23,42,0.95))] ${compact ? "aspect-square min-h-[68px]" : "h-[92px]"}`}
            title={`${item.name} • ${formatCosmeticTypeLabel(item.type, locale)}`}
            type="button"
          >
            <CosmeticThumbnail item={item} />
          </button>
        ))}
        <button
          onClick={onOpenInventory}
          className={`flex items-center justify-center rounded-[22px] border-2 border-dashed border-slate-300 bg-slate-100/80 text-slate-500 transition-colors hover:bg-slate-200 dark:border-slate-600 dark:bg-slate-900/60 dark:text-slate-300 dark:hover:bg-slate-800 ${compact ? "aspect-square min-h-[68px]" : "h-[92px]"}`}
          type="button"
          aria-label={t("profile.openInventory")}
        >
          <Plus size={18} />
        </button>
      </div>
    </div>
  );
}

function ProfileAvatarFrame({
  avatarImageUrl,
  frameItem,
  profileLoaded,
}: {
  avatarImageUrl: string | null;
  frameItem: InventoryItemView | null;
  profileLoaded: boolean;
}) {
  const frameTheme = frameItem
    ? resolveFrameTheme({
        renderMode: frameItem.renderMode,
        imageUrl: frameItem.imageUrl,
        templateKey: frameItem.templateKey,
        templateConfig: frameItem.templateConfig,
        rarity: frameItem.rarity,
      })
    : null;

  const framePatternStyle = frameTheme
    ? buildCosmeticPatternStyle({
        pattern: frameTheme.pattern,
        primaryColor: frameTheme.accentColor,
        secondaryColor: frameTheme.secondaryColor,
        scale: frameTheme.patternScale,
        opacity: frameTheme.patternOpacity,
      })
    : undefined;

  return (
    <div
      className={`relative flex h-28 w-28 items-center justify-center overflow-hidden rounded-[30px] shadow-xl ring-2 ring-white/50 dark:ring-slate-700 ${
        frameTheme ? getCosmeticMotionClass(frameTheme.motionPreset) : ""
      }`}
      style={
        frameTheme
          ? {
              padding: `${frameTheme.thickness}px`,
              borderRadius: `${frameTheme.radius}px`,
              backgroundColor: frameTheme.accentColor,
              boxShadow: `0 0 ${frameTheme.glowBlur}px ${frameTheme.glowColor}${Math.round(
                frameTheme.glowOpacity * 255
              )
                .toString(16)
                .padStart(2, "0")}`,
              ...getCosmeticMotionStyle(frameTheme.motionSpeedMs),
            }
          : undefined
      }
    >
      {frameTheme?.imageUrl ? (
        <Image src={frameTheme.imageUrl} alt="" fill unoptimized className="pointer-events-none absolute inset-0 object-cover opacity-85" />
      ) : null}
      {framePatternStyle ? (
        <div className="pointer-events-none absolute inset-0" style={framePatternStyle} aria-hidden="true" />
      ) : null}
      <div className="relative z-10 flex h-[92px] w-[92px] items-center justify-center overflow-hidden rounded-full bg-slate-200 text-3xl font-black text-slate-500 dark:bg-slate-800 dark:text-slate-300">
        {avatarImageUrl ? (
          <Image src={avatarImageUrl} alt="" width={92} height={92} unoptimized className="h-[92px] w-[92px] rounded-full object-cover" />
        ) : !profileLoaded ? (
          <div className="h-[92px] w-[92px] animate-pulse rounded-full bg-slate-200 dark:bg-slate-800" />
        ) : (
          <UserRound className="h-10 w-10" />
        )}
      </div>
    </div>
  );
}

function DiscoveryStripPanel({
  discoveryItems,
  leadItem,
  secondaryItems,
  onOpenShop,
}: {
  discoveryItems: CatalogStoreItemView[];
  leadItem: CatalogStoreItemView | null;
  secondaryItems: CatalogStoreItemView[];
  onOpenShop: () => void;
}) {
  const { locale, t } = useI18n();
  const stripItems = [leadItem, ...secondaryItems].filter(Boolean) as CatalogStoreItemView[];

  return (
    <div className="w-full text-left">
      <div className="mb-4 flex items-center justify-between gap-3">
        <div>
          <h3 className="flex items-center gap-2 text-xs font-black uppercase tracking-[0.22em] text-slate-500 dark:text-slate-400">
            <Sparkles size={12} />
            {t("profile.recommended")}
          </h3>
          <p className="mt-1.5 text-[11px] text-slate-500 dark:text-slate-400">
            {t("profile.recommendedHelp")}
          </p>
        </div>
        <button
          type="button"
          onClick={onOpenShop}
          className="inline-flex items-center gap-1 rounded-full border border-slate-200 bg-white/70 px-2.5 py-1 text-[10px] font-bold uppercase tracking-[0.18em] text-slate-600 transition hover:border-slate-300 hover:bg-white dark:border-slate-700 dark:bg-slate-900/60 dark:text-slate-300 dark:hover:bg-slate-900"
        >
          {t("profile.store")}
          <ArrowUpRight size={11} />
        </button>
      </div>

      {discoveryItems.length === 0 ? (
        <button
          type="button"
          onClick={onOpenShop}
          className="w-full rounded-2xl border border-dashed border-slate-300/70 bg-white/40 px-4 py-4 text-left text-xs font-medium text-slate-500 transition hover:bg-white/60 dark:border-slate-700/70 dark:bg-slate-900/30 dark:text-slate-400 dark:hover:bg-slate-900/50"
        >
          {t("profile.noDiscovery")}
        </button>
      ) : (
        <div className="grid grid-cols-2 gap-2 rounded-2xl border border-slate-200/70 bg-gradient-to-b from-white/85 to-slate-100/75 p-3 shadow-inner dark:border-slate-700/60 dark:from-slate-900/70 dark:to-slate-950/70">
          {stripItems.map((item) => (
            <button
              key={item.id}
              type="button"
              onClick={onOpenShop}
              className="flex min-w-0 flex-col rounded-2xl border border-white/70 bg-white/82 p-2.5 text-left transition hover:bg-white dark:border-slate-800/80 dark:bg-slate-900/80 dark:hover:bg-slate-900"
            >
              <div className="flex h-24 items-center justify-center overflow-hidden rounded-[18px] bg-[radial-gradient(circle_at_top,_rgba(255,255,255,0.48),_transparent_55%),linear-gradient(180deg,rgba(248,250,252,0.95),rgba(226,232,240,0.85))] p-1.5 dark:bg-[radial-gradient(circle_at_top,_rgba(255,255,255,0.08),_transparent_55%),linear-gradient(180deg,rgba(30,41,59,0.82),rgba(15,23,42,0.92))]">
                <CosmeticThumbnail item={item} />
              </div>
              <div className="mt-2 min-w-0">
                <div className="truncate text-xs font-black text-slate-800 dark:text-white">
                  {item.name}
                </div>
                <div className="mt-1 text-[10px] font-semibold text-slate-500 dark:text-slate-400">
                  {formatCosmeticTypeLabel(item.type, locale)}
                </div>
                <div className="mt-2 flex items-center gap-1 text-[11px] font-black text-amber-500">
                  {item.pricing.finalPriceCoin.toLocaleString()}
                  <CoinMark className="h-3.5 w-3.5 ring-0 shadow-none" iconClassName="h-2 w-2" />
                </div>
              </div>
            </button>
          ))}
        </div>
      )}
    </div>
  );
}
