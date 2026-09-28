"use client";

import { useEffect, useMemo, useState } from "react";
import { useSession } from "next-auth/react";
import { Eye, PackageOpen, X } from "lucide-react";
import { DashboardEmptyState, DashboardPageShell, DashboardSection } from "@/components/game/dashboard-page-shell";
import { CosmeticLargePreview, CosmeticThumbnail, formatCosmeticTypeLabel } from "@/components/game/cosmetic-preview";
import { CoinBadge } from "@/components/ui/coin-badge";
import { WALLET_UPDATED_EVENT } from "@/lib/wallet-events";
import { dispatchInventoryUpdated } from "@/lib/inventory-events";
import type {
  EquippedSlots,
  InventoryItemView,
  StoreItemRarity,
  StoreItemType,
  UserInventoryResponse,
} from "@/types/economy";
import { useI18n } from "@/components/providers/i18n-provider";
import { toIntlLocale } from "@/lib/i18n/config";

const rarityColor: Record<StoreItemRarity, string> = {
  common: "bg-slate-500",
  rare: "bg-blue-500",
  epic: "bg-purple-500",
  legendary: "bg-yellow-500",
};

const rarityBorder: Record<StoreItemRarity, string> = {
  common: "border-slate-300/30 dark:border-slate-700/30",
  rare: "border-blue-300/30 dark:border-blue-700/30",
  epic: "border-purple-400/30 dark:border-purple-600/30",
  legendary: "border-yellow-400/30 dark:border-yellow-600/30",
};

const rarityGlow: Record<StoreItemRarity, string> = {
  common: "",
  rare: "",
  epic: "shadow-[0_0_15px_rgba(168,85,247,0.3)]",
  legendary: "shadow-[0_0_15px_rgba(234,179,8,0.3)]",
};

const COSMETIC_GRID_BATCH_SIZE = 24;

function isItemEquipped(item: InventoryItemView, equippedSlots: EquippedSlots): boolean {
  if (item.type === "avatar") {
    return equippedSlots.avatarItemId === item.shopItemId;
  }
  if (item.type === "frame") {
    return equippedSlots.frameItemId === item.shopItemId;
  }
  if (item.type === "card_back") {
    return equippedSlots.cardBackItemId === item.shopItemId;
  }
  return equippedSlots.cardFaceItemId === item.shopItemId;
}

export function InventoryContent() {
  const { data: session } = useSession();
  const { locale, t } = useI18n();
  const tabs: { id: "all" | StoreItemType; label: string }[] = [
    { id: "all", label: t("inventory.all") },
    { id: "avatar", label: t("inventory.avatars") },
    { id: "frame", label: t("inventory.frames") },
    { id: "card_back", label: t("inventory.cardBacks") },
    { id: "card_face", label: t("inventory.cardFaces") },
  ];
  const [activeType, setActiveType] = useState<"all" | StoreItemType>("all");
  const [items, setItems] = useState<InventoryItemView[]>([]);
  const [previewItem, setPreviewItem] = useState<InventoryItemView | null>(null);
  const [equipBusyId, setEquipBusyId] = useState<number | null>(null);
  const [coinBalance, setCoinBalance] = useState(0);
  const [visibleItemCount, setVisibleItemCount] = useState(COSMETIC_GRID_BATCH_SIZE);
  const [equippedSlots, setEquippedSlots] = useState<EquippedSlots>({
    avatarItemId: null,
    frameItemId: null,
    cardBackItemId: null,
    cardFaceItemId: null,
  });

  useEffect(() => {
    if (!session?.user) {
      return;
    }

    const load = async () => {
      try {
        const response = await fetch("/api/user/inventory", { cache: "no-store" });
        if (!response.ok) {
          return;
        }

        const payload = (await response.json()) as UserInventoryResponse;
        setItems(payload.items);
        setCoinBalance(payload.wallet.coinBalance);
        setEquippedSlots({
          avatarItemId: payload.profile.avatarItemId,
          frameItemId: payload.profile.frameItemId,
          cardBackItemId: payload.profile.cardBackItemId,
          cardFaceItemId: payload.profile.cardFaceItemId,
        });
      } catch {
        // Keep defaults when fetch fails.
      }
    };

    void load();

    const handleWalletUpdated = () => {
      void load();
    };

    window.addEventListener(WALLET_UPDATED_EVENT, handleWalletUpdated);
    return () => {
      window.removeEventListener(WALLET_UPDATED_EVENT, handleWalletUpdated);
    };
  }, [session]);

  useEffect(() => {
    setItems((currentItems) =>
      currentItems.map((item) => ({
        ...item,
        equipped: isItemEquipped(item, equippedSlots),
      }))
    );
    setPreviewItem((current) => {
      if (!current) {
        return null;
      }

      return {
        ...current,
        equipped: isItemEquipped(current, equippedSlots),
      };
    });
  }, [equippedSlots]);

  const filteredItems = useMemo(
    () => activeType === "all" ? items : items.filter((item) => item.type === activeType),
    [activeType, items]
  );

  useEffect(() => {
    setVisibleItemCount(COSMETIC_GRID_BATCH_SIZE);
  }, [activeType]);

  const visibleItems = useMemo(
    () => filteredItems.slice(0, visibleItemCount),
    [filteredItems, visibleItemCount]
  );

  const handleEquip = async (item: InventoryItemView) => {
    if (equipBusyId !== null) {
      return;
    }

    setEquipBusyId(item.shopItemId);
    try {
      const response = await fetch("/api/store/equip", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          shopItemId: item.equipped ? null : item.shopItemId,
          itemType: item.type,
        }),
      });

      if (!response.ok) {
        return;
      }

      const payload = (await response.json()) as { equippedSlots: EquippedSlots };
      setEquippedSlots(payload.equippedSlots);
      dispatchInventoryUpdated();
    } catch {
      // Keep previous state on failure.
    } finally {
      setEquipBusyId(null);
    }
  };

  return (
    <DashboardPageShell
      eyebrow={t("inventory.collection")}
      title={t("inventory.title")}
      description={t("inventory.description")}
      action={<CoinBadge value={coinBalance} className="rounded-2xl px-4 py-3" valueClassName="text-xl" />}
    >
      <div className="space-y-6">
        <DashboardSection
          title={t("inventory.owned")}
          description={t("inventory.ownedHelp")}
          action={
            <div className="flex flex-wrap gap-2">
              {tabs.map((tab) => (
                <button
                  key={tab.id}
                  onClick={() => {
                    setActiveType(tab.id);
                    setPreviewItem(null);
                  }}
                  className={`rounded-full px-4 py-2 text-xs font-black uppercase tracking-[0.18em] transition-colors ${
                    activeType === tab.id
                      ? "bg-slate-900 text-white dark:bg-slate-100 dark:text-slate-900"
                      : "bg-slate-100 text-slate-600 hover:bg-slate-200 dark:bg-slate-900 dark:text-slate-300 dark:hover:bg-slate-800"
                  }`}
                  type="button"
                >
                  {tab.label}
                </button>
              ))}
            </div>
          }
          contentClassName="space-y-5"
        >
          <div className="flex min-h-0 gap-6 overflow-hidden">
            <div className="flex-1 overflow-y-auto pb-2">
              {filteredItems.length === 0 ? (
                <DashboardEmptyState
                  title={t("inventory.noItems")}
                  description={t("inventory.noItemsHelp")}
                  icon={<PackageOpen className="h-5 w-5" />}
                />
              ) : (
                <div className="space-y-5">
                  <div className="grid grid-cols-2 gap-4 lg:grid-cols-3 2xl:grid-cols-4">
                  {visibleItems.map((item) => (
                    <div
                      key={item.inventoryItemId}
                      className={`group relative flex flex-col rounded-[24px] border p-3 transition-all hover:-translate-y-0.5 hover:bg-white/85 dark:hover:bg-slate-950/60 ${rarityBorder[item.rarity]} ${rarityGlow[item.rarity]} ${item.equipped ? "ring-2 ring-blue-500/40" : ""}`}
                    >
                      <div className="relative mb-3 flex aspect-[0.95/1] items-center justify-center overflow-hidden rounded-[18px] border border-white/40 bg-[radial-gradient(circle_at_top,_rgba(255,255,255,0.48),_transparent_55%),linear-gradient(180deg,rgba(248,250,252,0.95),rgba(226,232,240,0.85))] p-4 dark:border-white/10 dark:bg-[radial-gradient(circle_at_top,_rgba(255,255,255,0.08),_transparent_55%),linear-gradient(180deg,rgba(30,41,59,0.82),rgba(15,23,42,0.92))]">
                        <div
                          className={`absolute right-2 top-2 z-10 rounded-full px-2 py-1 text-[9px] font-black uppercase tracking-[0.18em] text-white ${rarityColor[item.rarity]}`}
                        >
                          {item.rarity}
                        </div>
                        <button
                          onClick={() => setPreviewItem(item)}
                          className="absolute left-2 top-2 z-10 inline-flex h-8 w-8 items-center justify-center rounded-xl border border-slate-200/80 bg-white/90 text-slate-700 shadow-sm transition hover:bg-white dark:border-slate-700 dark:bg-slate-950/70 dark:text-slate-200 dark:hover:bg-slate-900"
                          type="button"
                          aria-label={t("inventory.previewLabel", { name: item.name })}
                        >
                          <Eye className="h-3.5 w-3.5" />
                        </button>
                        <CosmeticThumbnail item={item} />
                      </div>
                      <div className="flex-1">
                        <h3 className="text-sm font-black text-slate-900 dark:text-white">{item.name}</h3>
                        <p className="mt-1 text-xs font-medium text-slate-500 dark:text-slate-400">
                          {formatCosmeticTypeLabel(item.type, locale)} • {new Date(item.acquiredAt).toLocaleDateString(toIntlLocale(locale))}
                        </p>
                      </div>
                      <div className="mt-4 flex gap-2">
                        <button
                          onClick={() => void handleEquip(item)}
                          disabled={equipBusyId !== null}
                          className={`flex-1 rounded-xl px-3 py-2 text-xs font-black uppercase tracking-[0.14em] transition-colors ${
                            item.equipped
                              ? "bg-blue-500 text-white hover:bg-blue-600"
                              : "bg-slate-100 text-slate-600 hover:bg-blue-500 hover:text-white dark:bg-slate-900 dark:text-slate-300 dark:hover:bg-blue-600"
                          }`}
                          type="button"
                        >
                          {equipBusyId === item.shopItemId
                            ? (item.equipped ? t("inventory.unequipping") : t("inventory.equipping"))
                            : item.equipped
                              ? t("inventory.inUse")
                              : t("inventory.equip")}
                        </button>
                      </div>
                    </div>
                  ))}
                  </div>
                  {visibleItems.length < filteredItems.length ? (
                    <div className="flex flex-col items-center justify-center gap-2">
                      <button
                        type="button"
                        onClick={() => setVisibleItemCount((current) => current + COSMETIC_GRID_BATCH_SIZE)}
                        className="rounded-2xl border border-slate-200 bg-white px-5 py-2.5 text-xs font-black uppercase tracking-[0.16em] text-slate-700 transition hover:border-slate-300 hover:bg-slate-50 dark:border-slate-700 dark:bg-slate-950/60 dark:text-slate-200 dark:hover:bg-slate-900"
                      >
                        {t("inventory.showMore")}
                      </button>
                      <span className="text-xs font-medium text-slate-500 dark:text-slate-400">
                        {t("inventory.showing", { visible: visibleItems.length, total: filteredItems.length })}
                      </span>
                    </div>
                  ) : null}
                </div>
              )}
            </div>
          </div>
        </DashboardSection>
      </div>
      {previewItem ? (
        <InventoryPreviewModal selectedItem={previewItem} onClose={() => setPreviewItem(null)} />
      ) : null}
    </DashboardPageShell>
  );
}

function InventoryPreviewCard({
  selectedItem,
  className,
}: {
  selectedItem: InventoryItemView;
  className?: string;
}) {
  const { locale, t } = useI18n();
  return (
      <div className={`grid gap-6 lg:grid-cols-[minmax(0,1fr)_320px] ${className ?? ""}`}>
        <div className="rounded-[28px] border border-slate-200/80 bg-[radial-gradient(circle_at_top,_rgba(255,255,255,0.6),_transparent_60%),linear-gradient(180deg,rgba(248,250,252,0.96),rgba(226,232,240,0.9))] p-5 dark:border-slate-800/70 dark:bg-[radial-gradient(circle_at_top,_rgba(255,255,255,0.08),_transparent_60%),linear-gradient(180deg,rgba(17,24,39,0.96),rgba(2,6,23,0.96))]">
          <CosmeticLargePreview item={selectedItem} />
        </div>
        <div className="flex flex-col rounded-[28px] border border-white/60 bg-white/72 p-5 shadow-[0_20px_60px_-40px_rgba(15,23,42,0.45)] backdrop-blur-xl dark:border-slate-800/70 dark:bg-slate-950/45">
          <div className="text-[11px] font-black uppercase tracking-[0.22em] text-slate-500 dark:text-slate-400">
            {t("inventory.preview")}
          </div>
          <h4 className="mt-3 text-3xl font-black tracking-tight text-slate-900 dark:text-white">{selectedItem.name}</h4>
          <p className="mt-2 text-sm text-slate-500 dark:text-slate-400">
            {formatCosmeticTypeLabel(selectedItem.type, locale)} • {selectedItem.rarity}
          </p>
          <div
            className={`mt-5 inline-flex rounded-full border px-3 py-1 text-[10px] font-black uppercase tracking-[0.16em] ${
              selectedItem.rarity === "legendary"
                ? "border-yellow-200 bg-yellow-50 text-yellow-700 dark:border-yellow-900/30 dark:bg-yellow-950/20 dark:text-yellow-300"
                : selectedItem.rarity === "epic"
                  ? "border-purple-200 bg-purple-50 text-purple-700 dark:border-purple-900/30 dark:bg-purple-950/20 dark:text-purple-300"
                  : "border-blue-200 bg-blue-50 text-blue-700 dark:border-blue-900/30 dark:bg-blue-950/20 dark:text-blue-300"
            }`}
          >
            {selectedItem.equipped ? t("inventory.activeSlot") : t("inventory.readyToUse")}
          </div>
          <div className="mt-6 space-y-3 rounded-[24px] border border-slate-200/80 bg-slate-50/80 p-4 dark:border-slate-800/70 dark:bg-slate-950/50">
            <div>
              <div className="text-[11px] font-black uppercase tracking-[0.18em] text-slate-500 dark:text-slate-400">{t("inventory.acquiredAt")}</div>
              <div className="mt-1 text-sm font-semibold text-slate-800 dark:text-slate-100">{new Date(selectedItem.acquiredAt).toLocaleDateString(toIntlLocale(locale))}</div>
            </div>
            <div>
              <div className="text-[11px] font-black uppercase tracking-[0.18em] text-slate-500 dark:text-slate-400">{t("inventory.status")}</div>
              <div className="mt-1 text-sm font-semibold text-slate-800 dark:text-slate-100">{selectedItem.equipped ? t("inventory.currentlyInUse") : t("inventory.ready")}</div>
            </div>
          </div>
        </div>
      </div>
  );
}

function InventoryPreviewModal({
  selectedItem,
  onClose,
}: {
  selectedItem: InventoryItemView;
  onClose: () => void;
}) {
  return (
    <div className="fixed inset-0 z-[90] flex items-center justify-center bg-slate-950/70 px-4 py-6 backdrop-blur-sm" onClick={onClose}>
      <div
        className="relative max-h-[90vh] w-full max-w-3xl overflow-y-auto rounded-[32px] border border-white/10 bg-[linear-gradient(135deg,rgba(255,255,255,0.98),rgba(244,247,251,0.98),rgba(238,244,255,0.98))] p-5 shadow-[0_32px_90px_-50px_rgba(15,23,42,0.8)] dark:border-slate-800 dark:bg-[linear-gradient(135deg,rgba(15,23,42,0.96),rgba(17,24,39,0.96),rgba(23,37,84,0.95))] md:p-6"
        onClick={(event) => event.stopPropagation()}
      >
        <button
          type="button"
          onClick={onClose}
          className="absolute right-4 top-4 z-20 inline-flex h-10 w-10 items-center justify-center rounded-full border border-slate-200 bg-white text-slate-700 transition hover:bg-slate-50 dark:border-slate-700 dark:bg-slate-950/60 dark:text-slate-200 dark:hover:bg-slate-900"
        >
          <X className="h-4 w-4" />
        </button>
        <InventoryPreviewCard selectedItem={selectedItem} />
      </div>
    </div>
  );
}


