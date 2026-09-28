"use client";

import { useMemo, useState } from "react";
import { GripVertical, Search, Sparkles, Stars } from "lucide-react";
import {
    closestCenter,
    DndContext,
    type DragEndEvent,
    KeyboardSensor,
    PointerSensor,
    useSensor,
    useSensors,
} from "@dnd-kit/core";
import {
    SortableContext,
    arrayMove,
    sortableKeyboardCoordinates,
    useSortable,
    verticalListSortingStrategy,
} from "@dnd-kit/sortable";
import { CSS } from "@dnd-kit/utilities";
import { Input } from "@/components/ui/input";
import { cn } from "@/lib/utils";
import {
    ADMIN_RARITY_BADGE_CLASS,
    ADMIN_RARITY_SURFACE_CLASS,
    buildShopItemSortUpdates,
} from "@/lib/store/shop-admin";
import type { StoreItemRarity, StoreItemType } from "@/types/economy";

interface OrderableShopItem {
    id: number;
    code: string;
    name: string;
    type: StoreItemType;
    rarity: StoreItemRarity;
    sortOrder: number;
    badgeText: string | null;
    isFeatured: boolean;
    isActive: boolean;
}

interface ShopOrderBoardProps {
    items: OrderableShopItem[];
    saving: boolean;
    onReorder: (updates: Array<{ id: number; sortOrder: number }>) => void;
}

type OrderScope = "all" | "featured" | StoreItemType;

const typeLabels: Record<StoreItemType, string> = {
    avatar: "Avatar",
    frame: "Çerçeve",
    card_back: "Kart Arkası",
    card_face: "Kart Önü",
};

const scopeOptions: Array<{ value: OrderScope; label: string }> = [
    { value: "all", label: "Tümü" },
    { value: "featured", label: "Vitrin" },
    { value: "avatar", label: "Avatar" },
    { value: "frame", label: "Çerçeve" },
    { value: "card_back", label: "Kart Arkası" },
    { value: "card_face", label: "Kart Önü" },
];

function SortableShopOrderRow({ item }: { item: OrderableShopItem }) {
    const { attributes, listeners, setNodeRef, transform, transition, isDragging } = useSortable({ id: item.id });

    return (
        <div
            ref={setNodeRef}
            style={{ transform: CSS.Transform.toString(transform), transition }}
            className={cn(
                "rounded-2xl border px-3 py-3 shadow-sm transition",
                ADMIN_RARITY_SURFACE_CLASS[item.rarity],
                isDragging ? "scale-[1.01] shadow-xl ring-2 ring-blue-400/40" : "hover:-translate-y-0.5"
            )}
        >
            <div className="flex items-center gap-3">
                <button
                    type="button"
                    {...attributes}
                    {...listeners}
                    className="rounded-xl border border-current/10 bg-white/60 p-2 text-current/70 transition hover:text-current dark:bg-slate-950/40"
                    aria-label={`${item.name} sıralama tutamacı`}
                >
                    <GripVertical size={14} />
                </button>

                <div className="min-w-0 flex-1">
                    <div className="flex flex-wrap items-center gap-2">
                        <div className="truncate text-sm font-black text-foreground">{item.name}</div>
                        <span
                            className={cn(
                                "rounded-full px-2 py-0.5 text-[10px] font-black uppercase tracking-[0.18em]",
                                ADMIN_RARITY_BADGE_CLASS[item.rarity]
                            )}
                        >
                            {item.rarity}
                        </span>
                        <span className="rounded-full bg-black/5 px-2 py-0.5 text-[10px] font-bold uppercase tracking-[0.18em] text-current/80 dark:bg-white/5">
                            {typeLabels[item.type]}
                        </span>
                        {item.isFeatured ? (
                            <span className="inline-flex items-center gap-1 rounded-full bg-fuchsia-500/15 px-2 py-0.5 text-[10px] font-black uppercase tracking-[0.18em] text-fuchsia-700 dark:text-fuchsia-300">
                                <Stars size={10} />
                                Vitrin
                            </span>
                        ) : null}
                        {item.badgeText ? (
                            <span className="rounded-full bg-blue-500/15 px-2 py-0.5 text-[10px] font-black uppercase tracking-[0.18em] text-blue-700 dark:text-blue-300">
                                {item.badgeText}
                            </span>
                        ) : null}
                    </div>
                    <div className="mt-1 flex flex-wrap items-center gap-2 text-[11px] font-semibold uppercase tracking-[0.18em] text-current/75">
                        <span>{item.code}</span>
                        <span>#{item.sortOrder}</span>
                    </div>
                </div>
            </div>
        </div>
    );
}

export function ShopOrderBoard({ items, saving, onReorder }: ShopOrderBoardProps) {
    const sensors = useSensors(
        useSensor(PointerSensor),
        useSensor(KeyboardSensor, {
            coordinateGetter: sortableKeyboardCoordinates,
        })
    );
    const [search, setSearch] = useState("");
    const [scope, setScope] = useState<OrderScope>("all");

    const activeItems = useMemo(
        () => items.filter((item) => item.isActive).sort((left, right) => left.sortOrder - right.sortOrder),
        [items]
    );

    const visibleItems = useMemo(() => {
        const normalizedSearch = search.trim().toLowerCase();

        return activeItems.filter((item) => {
            if (scope === "featured" && !item.isFeatured) {
                return false;
            }

            if (scope !== "all" && scope !== "featured" && item.type !== scope) {
                return false;
            }

            if (!normalizedSearch) {
                return true;
            }

            return [item.name, item.code, item.badgeText ?? ""].some((value) =>
                value.toLowerCase().includes(normalizedSearch)
            );
        });
    }, [activeItems, scope, search]);

    const featuredCount = useMemo(() => activeItems.filter((item) => item.isFeatured).length, [activeItems]);

    const handleDragEnd = (event: DragEndEvent) => {
        const { active, over } = event;
        if (!over || active.id === over.id) {
            return;
        }

        const oldIndex = visibleItems.findIndex((item) => item.id === active.id);
        const newIndex = visibleItems.findIndex((item) => item.id === over.id);
        if (oldIndex < 0 || newIndex < 0) {
            return;
        }

        const reorderedVisible = arrayMove(visibleItems, oldIndex, newIndex);
        const visibleIdSet = new Set(reorderedVisible.map((item) => item.id));
        let visiblePointer = 0;

        const mergedOrder = activeItems.map((item) => {
            if (!visibleIdSet.has(item.id)) {
                return item;
            }

            const nextItem = reorderedVisible[visiblePointer];
            visiblePointer += 1;
            return nextItem;
        });

        onReorder(buildShopItemSortUpdates(mergedOrder.map((item) => item.id)));
    };

    return (
        <section className="rounded-[28px] border border-border/70 bg-gradient-to-br from-white via-slate-50 to-white p-5 shadow-sm dark:from-slate-950 dark:via-slate-900 dark:to-slate-950">
            <div className="flex flex-col gap-4">
                <div className="flex flex-col gap-4 xl:flex-row xl:items-start xl:justify-between">
                    <div className="max-w-3xl">
                        <div className="inline-flex items-center gap-2 rounded-full bg-blue-500/10 px-3 py-1 text-[10px] font-black uppercase tracking-[0.22em] text-blue-700 dark:text-blue-300">
                            <Sparkles size={12} />
                            Katalog Sırası
                        </div>
                        <h2 className="mt-3 text-xl font-black tracking-tight text-foreground">
                            Sürükle-bırak ile vitrin akışını yönet
                        </h2>
                        <p className="mt-1 text-sm text-muted-foreground">
                            Bu panel final mağaza sırasını ayarlar. Katalog büyüdüğünde önce arama veya kapsam filtresiyle alanı daralt, sonra yalnız ilgili segmenti sürükleyip bırak.
                        </p>
                    </div>

                    <div className="grid min-w-[260px] grid-cols-2 gap-3 rounded-3xl border border-border/70 bg-background/80 p-3 shadow-sm">
                        <div className="rounded-2xl bg-muted/30 px-3 py-2">
                            <div className="text-[10px] font-bold uppercase tracking-[0.18em] text-muted-foreground">Aktif</div>
                            <div className="mt-1 text-lg font-black text-foreground">{activeItems.length}</div>
                        </div>
                        <div className="rounded-2xl bg-muted/30 px-3 py-2">
                            <div className="text-[10px] font-bold uppercase tracking-[0.18em] text-muted-foreground">Vitrin</div>
                            <div className="mt-1 text-lg font-black text-foreground">{featuredCount}</div>
                        </div>
                    </div>
                </div>

                <div className="rounded-3xl border border-border/70 bg-background/70 p-4">
                    <div className="flex flex-col gap-3 xl:flex-row xl:items-center xl:justify-between">
                        <div className="relative w-full xl:max-w-md">
                            <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
                            <Input
                                value={search}
                                onChange={(event) => setSearch(event.target.value)}
                                placeholder="İsim, kod veya etiket ara..."
                                className="pl-9"
                            />
                        </div>

                        <div className="flex flex-wrap gap-2">
                            {scopeOptions.map((option) => (
                                <button
                                    key={option.value}
                                    type="button"
                                    onClick={() => setScope(option.value)}
                                    className={cn(
                                        "rounded-full border px-3 py-2 text-xs font-bold uppercase tracking-[0.16em] transition",
                                        scope === option.value
                                            ? "border-blue-500 bg-blue-500/10 text-blue-700 dark:text-blue-300"
                                            : "border-border bg-background text-muted-foreground hover:border-blue-300 hover:text-foreground"
                                    )}
                                >
                                    {option.label}
                                </button>
                            ))}
                        </div>
                    </div>

                    <div className="mt-3 flex flex-wrap items-center justify-between gap-3 text-xs text-muted-foreground">
                        <span>
                            Görünen sıra alanı: <span className="font-semibold text-foreground">{visibleItems.length}</span>
                        </span>
                        <span>
                            {scope === "all" && !search.trim()
                                ? "Tüm aktif katalog sırası düzenleniyor."
                                : "Yalnız görünen segment yeniden sıralanıyor; diğer aktif ürünler yerini korur."}
                        </span>
                    </div>
                </div>
            </div>

            {visibleItems.length === 0 ? (
                <div className="mt-4 rounded-3xl border border-dashed border-border/70 bg-background/60 px-4 py-8 text-center text-sm text-muted-foreground">
                    Bu filtrelerle sıralanacak aktif ürün bulunamadı.
                </div>
            ) : (
                <DndContext sensors={sensors} collisionDetection={closestCenter} onDragEnd={handleDragEnd}>
                    <SortableContext items={visibleItems.map((item) => item.id)} strategy={verticalListSortingStrategy}>
                        <div className="mt-4 space-y-3">
                            {visibleItems.map((item) => (
                                <SortableShopOrderRow key={item.id} item={item} />
                            ))}
                        </div>
                    </SortableContext>
                </DndContext>
            )}

            <div className="mt-4 flex flex-col gap-2 rounded-2xl border border-dashed border-border/70 bg-background/60 px-4 py-3 text-xs text-muted-foreground xl:flex-row xl:items-center xl:justify-between">
                <span>Pasif ürünler burada görünmez. Önce aktifleştir, sonra sırala.</span>
                <span className="font-semibold text-foreground">{saving ? "Kaydediliyor..." : "Sıra değişiklikleri canlı kaydediliyor"}</span>
            </div>
        </section>
    );
}
