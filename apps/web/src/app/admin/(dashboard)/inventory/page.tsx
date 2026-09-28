"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import Link from "next/link";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { Gift, Loader2, Search, ShieldAlert, Shirt, Sparkles, Trash2, UserRound } from "lucide-react";
import { toast } from "sonner";
import { AdminPageHeader } from "@/components/admin/admin-page-header";
import { AdminEmptyState, AdminTableShell } from "@/components/admin/admin-table-shell";
import { AdminToolbar, AdminToolbarStats } from "@/components/admin/admin-toolbar";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import {
    Dialog,
    DialogContent,
    DialogDescription,
    DialogFooter,
    DialogHeader,
    DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import type {
    AdminInventoryEquipSlot,
    AdminInventoryUserOption,
    AdminUserInventoryView,
} from "@/types/admin-inventory-operations";
import type { InventoryItemView, StoreItemView } from "@/types/economy";

type InventoryFilter =
    | "all"
    | "equipped"
    | "avatar"
    | "frame"
    | "card_back"
    | "card_face"
    | "purchase"
    | "grant"
    | "migration";

type GrantFilter = "all" | "visible" | "hidden" | "event_only";

const inventoryFilterLabels: Record<InventoryFilter, string> = {
    all: "Tümü",
    equipped: "Kuşanılanlar",
    avatar: "Avatar",
    frame: "Çerçeve",
    card_back: "Kart Arkası",
    card_face: "Kart Önü",
    purchase: "Satın Alım",
    grant: "Manuel Grant",
    migration: "Migrasyon",
};

const typeLabels = {
    avatar: "Avatar",
    frame: "Çerçeve",
    card_back: "Kart Arkası",
    card_face: "Kart Önü",
} as const;

const sourceLabels = {
    purchase: "Satın Alım",
    grant: "Grant",
    migration: "Migrasyon",
} as const;

const slotLabels: Record<AdminInventoryEquipSlot, string> = {
    avatar: "Avatar",
    frame: "Çerçeve",
    card_back: "Kart Arkası",
    card_face: "Kart Önü",
};

const sourceBadgeClasses = {
    purchase: "bg-destructive/10 text-destructive border-destructive/30",
    grant: "bg-amber-100 text-amber-700 border-amber-300 dark:bg-amber-900/30 dark:text-amber-300 dark:border-amber-700/40",
    migration: "bg-sky-100 text-sky-700 border-sky-300 dark:bg-sky-900/30 dark:text-sky-300 dark:border-sky-700/40",
} as const;

const grantFilterLabels: Record<GrantFilter, string> = {
    all: "Tümü",
    visible: "Görünür",
    hidden: "Gizli/Pasif",
    event_only: "Etkinlik",
};

function getGrantAvailabilityLabel(item: Pick<StoreItemView, "isActive" | "availabilityMode">): string {
    if (!item.isActive) {
        return "Pasif";
    }

    switch (item.availabilityMode) {
        case "event_only":
            return "Etkinlik";
        case "seasonal":
            return "Sezonluk";
        case "limited":
            return "Sınırlı";
        case "scheduled":
            return "Planlı";
        default:
            return "Görünür";
    }
}

function formatDateTime(value: string): string {
    return new Date(value).toLocaleString("tr-TR", {
        dateStyle: "short",
        timeStyle: "short",
    });
}

function SummaryPill({ label, value }: { label: string; value: string }) {
    return (
        <div className="rounded-2xl border border-border/70 bg-muted/20 px-3 py-3">
            <div className="text-[10px] font-black uppercase tracking-[0.18em] text-muted-foreground">{label}</div>
            <div className="mt-1 text-sm font-semibold text-foreground">{value}</div>
        </div>
    );
}

function buildSupportHref(username: string): string {
    return `/admin/support?search=${encodeURIComponent(username)}`;
}

function buildUsersHref(username: string): string {
    return `/admin/users?search=${encodeURIComponent(username)}`;
}

function buildAuditHref(username: string): string {
    return `/admin/audit?search=${encodeURIComponent(username)}`;
}

export default function AdminInventoryPage() {
    const router = useRouter();
    const pathname = usePathname();
    const searchParams = useSearchParams();
    const pendingUserIdRef = useRef<number | null>(null);
    const hydratedRef = useRef(false);
    const [search, setSearch] = useState("");
    const [debouncedUserSearch, setDebouncedUserSearch] = useState("");
    const [users, setUsers] = useState<AdminInventoryUserOption[]>([]);
    const [selectedUserId, setSelectedUserId] = useState<number | null>(null);
    const [inventory, setInventory] = useState<AdminUserInventoryView | null>(null);
    const [grantReason, setGrantReason] = useState("");
    const [grantSearch, setGrantSearch] = useState("");
    const [grantFilter, setGrantFilter] = useState<GrantFilter>("all");
    const [inventorySearch, setInventorySearch] = useState("");
    const [grantItemId, setGrantItemId] = useState<number | null>(null);
    const [inventoryFilter, setInventoryFilter] = useState<InventoryFilter>("all");
    const [loadingUsers, setLoadingUsers] = useState(true);
    const [loadingInventory, setLoadingInventory] = useState(false);
    const [loadingGrantOptions, setLoadingGrantOptions] = useState(true);
    const [grantOptions, setGrantOptions] = useState<StoreItemView[]>([]);
    const [grantSaving, setGrantSaving] = useState(false);
    const [revokeSavingId, setRevokeSavingId] = useState<number | null>(null);
    const [resettingSlot, setResettingSlot] = useState<AdminInventoryEquipSlot | null>(null);
    const [grantConfirmOpen, setGrantConfirmOpen] = useState(false);
    const [revokeTarget, setRevokeTarget] = useState<InventoryItemView | null>(null);
    const [revokeReason, setRevokeReason] = useState("");
    const [revokeOverrideConfirmed, setRevokeOverrideConfirmed] = useState(false);
    const [resetTargetSlot, setResetTargetSlot] = useState<AdminInventoryEquipSlot | null>(null);

    useEffect(() => {
        const nextSearch = (searchParams.get("search") ?? "").trim();
        const nextUserId = Number(searchParams.get("userId") ?? "");

        setSearch(nextSearch);
        setDebouncedUserSearch(nextSearch);
        pendingUserIdRef.current = Number.isInteger(nextUserId) && nextUserId > 0 ? nextUserId : null;
        hydratedRef.current = true;
    }, [searchParams]);

    useEffect(() => {
        if (!hydratedRef.current) {
            return;
        }

        const params = new URLSearchParams();

        if (search.trim()) {
            params.set("search", search.trim());
        }

        if (selectedUserId) {
            params.set("userId", String(selectedUserId));
        }

        const next = params.toString();
        const current =
            typeof window === "undefined"
                ? ""
                : window.location.search.startsWith("?")
                  ? window.location.search.slice(1)
                  : window.location.search;

        if (next !== current) {
            router.replace(next ? `${pathname}?${next}` : pathname, { scroll: false });
        }
    }, [pathname, router, search, selectedUserId]);

    useEffect(() => {
        const timeoutId = window.setTimeout(() => {
            setDebouncedUserSearch(search.trim());
        }, 300);

        return () => {
            window.clearTimeout(timeoutId);
        };
    }, [search]);

    const loadUsers = useCallback(async () => {
        setLoadingUsers(true);
        try {
            const params = new URLSearchParams({
                page: "1",
                limit: "12",
                status: "all",
            });
            if (debouncedUserSearch) {
                params.set("search", debouncedUserSearch);
            }

            const response = await fetch(`/api/admin/users?${params.toString()}`, {
                cache: "no-store",
            });
            if (!response.ok) {
                return;
            }

            const payload = (await response.json()) as {
                users: Array<{
                    id: number;
                    username: string;
                    email: string | null;
                    role: string;
                    displayName: string | null;
                }>;
            };

            const mappedUsers: AdminInventoryUserOption[] = payload.users.map((user) => ({
                id: user.id,
                username: user.username,
                displayName: user.displayName,
                email: user.email,
                role: user.role,
            }));

            setUsers(mappedUsers);
            setSelectedUserId((current) => {
                if (
                    pendingUserIdRef.current &&
                    mappedUsers.some((user) => user.id === pendingUserIdRef.current)
                ) {
                    return pendingUserIdRef.current;
                }
                if (current && mappedUsers.some((user) => user.id === current)) {
                    return current;
                }
                return mappedUsers[0]?.id ?? null;
            });
            if (
                pendingUserIdRef.current &&
                mappedUsers.some((user) => user.id === pendingUserIdRef.current)
            ) {
                pendingUserIdRef.current = null;
            }
        } finally {
            setLoadingUsers(false);
        }
    }, [debouncedUserSearch]);

    const loadInventory = useCallback(async (userId: number) => {
        setLoadingInventory(true);
        try {
            const response = await fetch(`/api/admin/users/${userId}/inventory`, {
                cache: "no-store",
            });
            if (!response.ok) {
                setInventory(null);
                return;
            }

            const payload = (await response.json()) as AdminUserInventoryView;
            setInventory(payload);
        } finally {
            setLoadingInventory(false);
        }
    }, []);

    const loadGrantOptions = useCallback(async () => {
        setLoadingGrantOptions(true);
        try {
            const response = await fetch("/api/admin/shop-items", {
                cache: "no-store",
            });
            if (!response.ok) {
                return;
            }
            const payload = (await response.json()) as StoreItemView[];
            setGrantOptions(payload);
            setGrantItemId((current) => current ?? payload[0]?.id ?? null);
        } finally {
            setLoadingGrantOptions(false);
        }
    }, []);

    useEffect(() => {
        void loadUsers();
    }, [loadUsers]);

    useEffect(() => {
        if (!selectedUserId) {
            setInventory(null);
            return;
        }
        void loadInventory(selectedUserId);
    }, [loadInventory, selectedUserId]);

    useEffect(() => {
        void loadGrantOptions();
    }, [loadGrantOptions]);

    const filteredItems = useMemo(() => {
        if (!inventory) {
            return [];
        }

        const normalizedSearch = inventorySearch.trim().toLowerCase();

        return inventory.items.filter((item) => {
            const matchesSearch =
                !normalizedSearch ||
                [item.name, item.code, item.type, item.source, item.rarity, item.badgeText ?? ""]
                    .join(" ")
                    .toLowerCase()
                    .includes(normalizedSearch);
            if (!matchesSearch) {
                return false;
            }
            if (inventoryFilter === "all") {
                return true;
            }
            if (inventoryFilter === "equipped") {
                return item.equipped;
            }
            if (inventoryFilter === "purchase" || inventoryFilter === "grant" || inventoryFilter === "migration") {
                return item.source === inventoryFilter;
            }
            return item.type === inventoryFilter;
        });
    }, [inventory, inventoryFilter, inventorySearch]);

    const equippedSlotItems = useMemo(() => {
        if (!inventory) {
            return [];
        }

        return (Object.keys(slotLabels) as AdminInventoryEquipSlot[]).map((slot) => {
            const shopItemId =
                slot === "avatar"
                    ? inventory.profile.avatarItemId
                    : slot === "frame"
                      ? inventory.profile.frameItemId
                      : slot === "card_back"
                        ? inventory.profile.cardBackItemId
                        : inventory.profile.cardFaceItemId;
            const item = inventory.items.find((entry) => entry.shopItemId === shopItemId) ?? null;
            return {
                slot,
                item,
            };
        });
    }, [inventory]);

    const filteredGrantOptions = useMemo(() => {
        const normalizedSearch = grantSearch.trim().toLowerCase();
        return grantOptions.filter((item) => {
            const matchesFilter =
                grantFilter === "all"
                    ? true
                    : grantFilter === "visible"
                      ? item.isActive && item.availabilityMode !== "event_only"
                      : grantFilter === "hidden"
                        ? !item.isActive || item.availabilityMode === "scheduled"
                        : item.availabilityMode === "event_only";
            if (!matchesFilter) {
                return false;
            }
            if (!normalizedSearch) {
                return true;
            }
            return [item.name, item.code, item.type, item.badgeText ?? ""]
                .join(" ")
                .toLowerCase()
                .includes(normalizedSearch);
        });
    }, [grantFilter, grantOptions, grantSearch]);

    const selectedGrantItem = useMemo(
        () =>
            filteredGrantOptions.find((item) => item.id === grantItemId) ??
            grantOptions.find((item) => item.id === grantItemId) ??
            null,
        [filteredGrantOptions, grantItemId, grantOptions]
    );

    const selectedUser = useMemo(
        () => users.find((user) => user.id === selectedUserId) ?? null,
        [selectedUserId, users]
    );

    const resetTargetItem = useMemo(
        () => equippedSlotItems.find((entry) => entry.slot === resetTargetSlot)?.item ?? null,
        [equippedSlotItems, resetTargetSlot]
    );

    const revokeRequiresOverride = Boolean(revokeTarget && revokeTarget.source !== "grant");

    const submitGrant = useCallback(async () => {
        if (!selectedUserId || !grantItemId || grantReason.trim().length < 3) {
            return;
        }

        setGrantSaving(true);
        try {
            const response = await fetch(`/api/admin/users/${selectedUserId}/inventory/grant`, {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({
                    shopItemId: grantItemId,
                    reason: grantReason.trim(),
                }),
            });

            const payload = (await response.json().catch(() => ({ error: "Item grant işlemi tamamlanamadı." }))) as {
                error?: string;
                shopItemName?: string;
            };
            if (!response.ok) {
                toast.error(payload.error || "Item grant işlemi tamamlanamadı.");
                return;
            }

            toast.success(`${payload.shopItemName ?? "Item"} oyuncu envanterine eklendi.`);
            setGrantReason("");
            setGrantConfirmOpen(false);
            await loadInventory(selectedUserId);
        } finally {
            setGrantSaving(false);
        }
    }, [grantItemId, grantReason, loadInventory, selectedUserId]);

    const submitRevoke = useCallback(async () => {
        if (!selectedUserId || !revokeTarget || revokeReason.trim().length < 3) {
            return;
        }

        setRevokeSavingId(revokeTarget.inventoryItemId);
        try {
            const response = await fetch(`/api/admin/users/${selectedUserId}/inventory/revoke`, {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({
                    inventoryItemId: revokeTarget.inventoryItemId,
                    reason: revokeReason.trim(),
                    overrideProtectedSource: revokeRequiresOverride,
                }),
            });

            const payload = (await response.json().catch(() => ({ error: "Item revoke işlemi tamamlanamadı." }))) as {
                error?: string;
                shopItemName?: string;
            };
            if (!response.ok) {
                toast.error(payload.error || "Item revoke işlemi tamamlanamadı.");
                return;
            }

            toast.success(`${payload.shopItemName ?? "Item"} envanterden kaldırıldı.`);
            setRevokeTarget(null);
            setRevokeReason("");
            setRevokeOverrideConfirmed(false);
            await loadInventory(selectedUserId);
        } finally {
            setRevokeSavingId(null);
        }
    }, [loadInventory, revokeReason, revokeRequiresOverride, revokeTarget, selectedUserId]);

    const submitEquipReset = useCallback(async () => {
        if (!selectedUserId || !resetTargetSlot) {
            return;
        }

        setResettingSlot(resetTargetSlot);
        try {
            const response = await fetch(`/api/admin/users/${selectedUserId}/inventory/equip-reset`, {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({ slot: resetTargetSlot }),
            });

            const payload = (await response.json().catch(() => ({ error: "Equip reset işlemi tamamlanamadı." }))) as {
                error?: string;
                clearedShopItemName?: string | null;
                alreadyEmpty?: boolean;
            };
            if (!response.ok) {
                toast.error(payload.error || "Equip reset işlemi tamamlanamadı.");
                return;
            }

            if (payload.alreadyEmpty) {
                toast.info(`${slotLabels[resetTargetSlot]} slotu zaten boş.`);
            } else {
                toast.success(
                    payload.clearedShopItemName
                        ? `${payload.clearedShopItemName} kuşanımdan çıkarıldı.`
                        : `${slotLabels[resetTargetSlot]} slotu sıfırlandı.`
                );
            }
            setResetTargetSlot(null);
            await loadInventory(selectedUserId);
        } finally {
            setResettingSlot(null);
        }
    }, [loadInventory, resetTargetSlot, selectedUserId]);

    return (
        <div className="space-y-6">
            <AdminPageHeader
                title="Envanter Operasyonları"
                description="Oyuncu envanterini inceleyin, grant veya kaldırma işlemlerini onay adımıyla yönetin ve kuşanım slotlarını güvenli şekilde sıfırlayın."
                meta={inventory ? `${inventory.items.length} item` : "hazırlanıyor"}
                icon={<Shirt className="h-5 w-5 text-amber-500" />}
            />

            <AdminToolbar>
                <div className="relative flex-1">
                    <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
                    <Input
                        value={search}
                        onChange={(event) => setSearch(event.target.value)}
                        placeholder="Kullanıcı adı, e-posta veya görünen isim ara..."
                        className="pl-9"
                    />
                </div>
                <AdminToolbarStats
                    stats={[
                        { label: "oyuncu", value: String(users.length) },
                        { label: "seçili", value: inventory ? inventory.username : "-" },
                        { label: "görünen item", value: String(filteredItems.length) },
                    ]}
                />
            </AdminToolbar>

            <div className="grid gap-6 xl:grid-cols-[340px_minmax(0,1fr)]">
                <Card>
                    <CardHeader>
                        <CardTitle>Oyuncular</CardTitle>
                    </CardHeader>
                    <CardContent className="space-y-3">
                        {loadingUsers ? (
                            <div className="flex items-center gap-2 text-sm text-muted-foreground">
                                <Loader2 className="h-4 w-4 animate-spin" />
                                Oyuncular yükleniyor...
                            </div>
                        ) : null}
                        {!loadingUsers && users.length === 0 ? (
                            <AdminEmptyState
                                icon={<UserRound className="h-6 w-6" />}
                                title="Oyuncu bulunamadı"
                                description="Mevcut aramayla eşleşen kullanıcı yok."
                            />
                        ) : null}
                        {users.map((user) => {
                            const isSelected = user.id === selectedUserId;
                            return (
                                <button
                                    key={user.id}
                                    type="button"
                                    onClick={() => setSelectedUserId(user.id)}
                                    className={`w-full rounded-2xl border px-4 py-3 text-left transition ${
                                        isSelected
                                            ? "border-amber-400 bg-amber-50/70 dark:bg-amber-950/20"
                                            : "border-border/70 bg-background hover:border-amber-300"
                                    }`}
                                >
                                    <div className="font-semibold text-foreground">{user.displayName || user.username}</div>
                                    <div className="mt-1 text-xs text-muted-foreground">
                                        @{user.username} · {user.role}
                                    </div>
                                    <div className="mt-1 text-xs text-muted-foreground">{user.email || "E-posta yok"}</div>
                                </button>
                            );
                        })}
                    </CardContent>
                </Card>

                <div className="space-y-6">
                    <Card>
                        <CardHeader>
                            <CardTitle>Manuel Grant</CardTitle>
                        </CardHeader>
                        <CardContent className="space-y-4">
                            <div className="text-sm text-muted-foreground">
                                Seçili oyuncuya doğrudan kozmetik tanımla. Duplicate grant engellenir ve işlem onay adımından sonra uygulanır.
                            </div>
                            <Input
                                value={grantSearch}
                                onChange={(event) => setGrantSearch(event.target.value)}
                                placeholder="Grant edilecek item ara..."
                            />
                            <div className="flex flex-wrap gap-2">
                                {(Object.keys(grantFilterLabels) as GrantFilter[]).map((filter) => (
                                    <button
                                        key={filter}
                                        type="button"
                                        onClick={() => setGrantFilter(filter)}
                                        className={`rounded-full px-3 py-1.5 text-xs font-semibold transition ${
                                            grantFilter === filter
                                                ? "bg-amber-500 text-white"
                                                : "bg-muted text-muted-foreground hover:text-foreground"
                                        }`}
                                    >
                                        {grantFilterLabels[filter]}
                                    </button>
                                ))}
                            </div>
                            <select
                                value={grantItemId ?? ""}
                                onChange={(event) => setGrantItemId(Number(event.target.value))}
                                className="h-10 w-full rounded-xl border border-border bg-background px-3 text-sm outline-none"
                                disabled={loadingGrantOptions || filteredGrantOptions.length === 0}
                            >
                                {filteredGrantOptions.length === 0 ? <option value="">Item bulunamadı</option> : null}
                                {filteredGrantOptions.map((item) => (
                                    <option key={item.id} value={item.id}>
                                        {item.name} ({typeLabels[item.type]}) · {item.code}
                                    </option>
                                ))}
                            </select>
                            {selectedGrantItem ? (
                                <div className="rounded-2xl border border-border/70 bg-muted/15 p-4 text-sm">
                                    <div className="flex flex-wrap items-start justify-between gap-3">
                                        <div>
                                            <div className="font-semibold text-foreground">{selectedGrantItem.name}</div>
                                            <div className="mt-1 text-xs text-muted-foreground">
                                                {selectedGrantItem.code} · {typeLabels[selectedGrantItem.type]} · {selectedGrantItem.rarity}
                                            </div>
                                        </div>
                                        <div className="rounded-full border border-border/70 bg-background px-2.5 py-1 text-[10px] font-bold uppercase tracking-[0.18em] text-muted-foreground">
                                            {getGrantAvailabilityLabel(selectedGrantItem)}
                                        </div>
                                    </div>
                                    {!selectedGrantItem.isActive || selectedGrantItem.availabilityMode === "event_only" ? (
                                        <div className="mt-3 rounded-2xl border border-amber-300/70 bg-amber-50 px-3 py-2 text-xs text-amber-800 dark:border-amber-700/40 dark:bg-amber-950/20 dark:text-amber-200">
                                            Bu item normal oyuncu mağazasında görünmeyebilir. Grant işlemi özel dağıtım olarak değerlendirilecek.
                                        </div>
                                    ) : null}
                                </div>
                            ) : null}
                            <textarea
                                value={grantReason}
                                onChange={(event) => setGrantReason(event.target.value)}
                                rows={3}
                                className="min-h-[96px] w-full resize-y rounded-2xl border border-border bg-background px-3 py-2.5 text-sm outline-none focus:border-primary"
                                placeholder="Grant gerekçesini yaz..."
                            />
                            <Button
                                type="button"
                                onClick={() => setGrantConfirmOpen(true)}
                                disabled={!selectedUserId || !grantItemId || grantReason.trim().length < 3 || grantSaving}
                                className="gap-2"
                            >
                                <Gift className="h-4 w-4" />
                                Grant Et
                            </Button>
                        </CardContent>
                    </Card>

                    <AdminTableShell
                        title="Seçili Oyuncu Envanteri"
                        description="Grant, revoke ve equip reset akışları ekstra onay katmanıyla çalışır. Purchase ve migration kaynaklı kaldırma işlemleri ek onay ister."
                        loading={loadingInventory}
                        isEmpty={!loadingInventory && !inventory}
                        emptyState={
                            <AdminEmptyState
                                icon={<Sparkles className="h-6 w-6" />}
                                title="Envanter verisi yok"
                                description="Soldan bir oyuncu seçerek envanteri görüntüleyin."
                            />
                        }
                    >
                        {inventory ? (
                            <div className="space-y-5">
                                <div className="rounded-2xl border border-border/70 bg-muted/10 p-4">
                                    <div className="flex flex-wrap items-start justify-between gap-4">
                                        <div>
                                            <div className="text-lg font-semibold text-foreground">
                                                {inventory.profile.displayName || inventory.username}
                                            </div>
                                            <div className="mt-1 text-sm text-muted-foreground">
                                                @{inventory.username} · {inventory.role}
                                            </div>
                                            <div className="mt-1 text-sm text-muted-foreground">
                                                {inventory.email || "E-posta yok"}
                                            </div>
                                        </div>
                                        <div className="flex flex-wrap gap-2">
                                            <Button asChild variant="outline" size="sm">
                                                <Link href={buildSupportHref(inventory.username)}>Destek</Link>
                                            </Button>
                                            <Button asChild variant="outline" size="sm">
                                                <Link href={buildUsersHref(inventory.username)}>Kullanici</Link>
                                            </Button>
                                            <Button asChild variant="outline" size="sm">
                                                <Link href={buildAuditHref(inventory.username)}>Audit</Link>
                                            </Button>
                                        </div>
                                    </div>
                                    <div className="mt-4 grid gap-3 md:grid-cols-3">
                                        <SummaryPill
                                            label="Korumali Sahiplik"
                                            value={String(
                                                inventory.items.filter((item) => item.source !== "grant").length
                                            )}
                                        />
                                        <SummaryPill
                                            label="Son Operasyon"
                                            value={
                                                inventory.recentOperations[0]
                                                    ? formatDateTime(inventory.recentOperations[0].createdAt)
                                                    : "-"
                                            }
                                        />
                                        <SummaryPill
                                            label="Operasyon Kaydi"
                                            value={String(inventory.recentOperations.length)}
                                        />
                                    </div>
                                </div>

                                <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-4">
                                    <SummaryPill label="Toplam Item" value={String(inventory.summary.totalItems)} />
                                    <SummaryPill label="Kuşanılan" value={String(inventory.summary.equippedItems)} />
                                    <SummaryPill label="Coin" value={inventory.coinBalance.toLocaleString("tr-TR")} />
                                    <SummaryPill label="Profil" value={inventory.profile.displayName || inventory.username} />
                                </div>

                                <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-4">
                                    <SummaryPill label="Avatar" value={String(inventory.summary.byType.avatar)} />
                                    <SummaryPill label="Çerçeve" value={String(inventory.summary.byType.frame)} />
                                    <SummaryPill label="Kart Arkası" value={String(inventory.summary.byType.card_back)} />
                                    <SummaryPill label="Kart Önü" value={String(inventory.summary.byType.card_face)} />
                                </div>

                                <div className="grid gap-3 md:grid-cols-3">
                                    <SummaryPill label="Satın Alım" value={String(inventory.summary.bySource.purchase)} />
                                    <SummaryPill label="Grant" value={String(inventory.summary.bySource.grant)} />
                                    <SummaryPill label="Migrasyon" value={String(inventory.summary.bySource.migration)} />
                                </div>

                                <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-4">
                                    {equippedSlotItems.map(({ slot, item }) => (
                                        <div key={slot} className="rounded-2xl border border-border/70 bg-muted/15 p-4">
                                            <div className="text-[10px] font-black uppercase tracking-[0.18em] text-muted-foreground">
                                                {slotLabels[slot]}
                                            </div>
                                            <div className="mt-2 min-h-[44px] text-sm font-semibold text-foreground">
                                                {item?.name ?? "Boş"}
                                            </div>
                                            <Button
                                                type="button"
                                                variant="outline"
                                                size="sm"
                                                className="mt-3 w-full"
                                                disabled={resettingSlot === slot}
                                                onClick={() => setResetTargetSlot(slot)}
                                            >
                                                {resettingSlot === slot ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : null}
                                                Slotu Sıfırla
                                            </Button>
                                        </div>
                                    ))}
                                </div>

                                <div className="flex flex-wrap gap-2">
                                    {(Object.keys(inventoryFilterLabels) as InventoryFilter[]).map((filter) => (
                                        <button
                                            key={filter}
                                            type="button"
                                            onClick={() => setInventoryFilter(filter)}
                                            className={`rounded-full px-3 py-1.5 text-xs font-semibold transition ${
                                                inventoryFilter === filter
                                                    ? "bg-amber-500 text-white"
                                                    : "bg-muted text-muted-foreground hover:text-foreground"
                                            }`}
                                        >
                                            {inventoryFilterLabels[filter]}
                                        </button>
                                    ))}
                                </div>

                                <Input
                                    value={inventorySearch}
                                    onChange={(event) => setInventorySearch(event.target.value)}
                                    placeholder="Envanter item adı, kodu, kaynak veya nadirlik ara..."
                                />

                                <div className="grid gap-3 lg:grid-cols-2">
                                    {filteredItems.length ? (
                                        filteredItems.map((item) => (
                                            <div key={item.inventoryItemId} className="rounded-2xl border border-border/70 bg-background p-4">
                                                <div className="flex items-start justify-between gap-3">
                                                    <div className="space-y-1">
                                                        <div className="font-semibold text-foreground">{item.name}</div>
                                                        <div className="text-xs font-mono text-muted-foreground">{item.code}</div>
                                                    </div>
                                                    <div className="flex flex-wrap justify-end gap-2">
                                                        {item.equipped ? (
                                                            <span className="rounded-full bg-emerald-100 px-2.5 py-1 text-[10px] font-bold uppercase tracking-[0.18em] text-emerald-700 dark:bg-emerald-900/30 dark:text-emerald-300">
                                                                Kuşanılı
                                                            </span>
                                                        ) : null}
                                                        <span
                                                            className={`rounded-full border px-2.5 py-1 text-[10px] font-bold uppercase tracking-[0.18em] ${sourceBadgeClasses[item.source]}`}
                                                        >
                                                            {sourceLabels[item.source]}
                                                        </span>
                                                        <span className="rounded-full bg-muted px-2.5 py-1 text-[10px] font-bold uppercase tracking-[0.18em] text-muted-foreground">
                                                            {typeLabels[item.type]}
                                                        </span>
                                                    </div>
                                                </div>

                                                <div className="mt-4 grid gap-2 text-xs text-muted-foreground sm:grid-cols-2">
                                                    <div>
                                                        <span className="font-semibold text-foreground">Kaynak:</span> {sourceLabels[item.source]}
                                                    </div>
                                                    <div>
                                                        <span className="font-semibold text-foreground">Nadirlik:</span> {item.rarity}
                                                    </div>
                                                    <div>
                                                        <span className="font-semibold text-foreground">Alındı:</span> {formatDateTime(item.acquiredAt)}
                                                    </div>
                                                    <div>
                                                        <span className="font-semibold text-foreground">Fiyat Referansı:</span>{" "}
                                                        {item.priceCoin.toLocaleString("tr-TR")} coin
                                                    </div>
                                                </div>

                                                <div className="mt-4 flex justify-end">
                                                    <Button
                                                        type="button"
                                                        variant={item.source === "grant" ? "outline" : "destructive"}
                                                        size="sm"
                                                        className="gap-2"
                                                        disabled={revokeSavingId === item.inventoryItemId}
                                                        onClick={() => {
                                                            setRevokeTarget(item);
                                                            setRevokeReason("");
                                                            setRevokeOverrideConfirmed(false);
                                                        }}
                                                    >
                                                        {revokeSavingId === item.inventoryItemId ? (
                                                            <Loader2 className="h-4 w-4 animate-spin" />
                                                        ) : (
                                                            <Trash2 className="h-4 w-4" />
                                                        )}
                                                        {item.source === "grant" ? "Grant Kaldır" : "Sahipliği Kaldır"}
                                                    </Button>
                                                </div>
                                            </div>
                                        ))
                                    ) : (
                                        <div className="rounded-2xl border border-dashed border-border/70 px-4 py-8 text-sm text-muted-foreground lg:col-span-2">
                                            Mevcut filtrelerle eşleşen envanter kaydı yok.
                                        </div>
                                    )}
                                </div>
                            </div>
                        ) : null}
                    </AdminTableShell>

                    <Card>
                        <CardHeader>
                            <CardTitle>Operasyon Notları</CardTitle>
                        </CardHeader>
                        <CardContent className="space-y-4">
                            <div className="grid gap-3 md:grid-cols-3">
                                <SummaryPill label="Grant" value="onaylı akış" />
                                <SummaryPill label="Revoke" value="korumalı kaynak desteği" />
                                <SummaryPill label="Equip Reset" value="onaylı akış" />
                            </div>

                            <details className="group rounded-2xl border border-border/70 bg-muted/10">
                                <summary className="flex cursor-pointer list-none items-center justify-between gap-3 px-4 py-3">
                                    <div>
                                        <div className="text-sm font-semibold text-foreground">Son Operasyonlar</div>
                                        <div className="text-xs text-muted-foreground">
                                            Seçili oyuncu için son grant, revoke ve equip reset kayıtları
                                        </div>
                                    </div>
                                    <span className="text-xs font-semibold text-muted-foreground transition group-open:rotate-180">
                                        ▼
                                    </span>
                                </summary>

                                <div className="border-t border-border/70 px-4 py-4">
                                    {inventory?.recentOperations.length ? (
                                        <div className="space-y-3">
                                            {inventory.recentOperations.map((operation) => (
                                                <div key={operation.id} className="rounded-2xl border border-border/70 bg-background p-4">
                                                    <div className="flex flex-wrap items-start justify-between gap-3">
                                                        <div>
                                                            <div className="text-sm font-semibold text-foreground">
                                                                {operation.summary || operation.action}
                                                            </div>
                                                            <div className="mt-1 text-xs text-muted-foreground">
                                                                {formatDateTime(operation.createdAt)} · {operation.actorUsername || "Sistem"} · {operation.actorRole}
                                                            </div>
                                                        </div>
                                                        <div className="rounded-full bg-muted px-2.5 py-1 text-[10px] font-bold uppercase tracking-[0.18em] text-muted-foreground">
                                                            {operation.action}
                                                        </div>
                                                    </div>
                                                    <div className="mt-3 text-sm text-muted-foreground">
                                                        <span className="font-semibold text-foreground">Not:</span>{" "}
                                                        {operation.note || "Not girilmemiş."}
                                                    </div>
                                                </div>
                                            ))}
                                        </div>
                                    ) : (
                                        <div className="rounded-2xl border border-dashed border-border/70 px-4 py-5 text-sm text-muted-foreground">
                                            Seçili oyuncu için henüz grant, revoke veya equip reset geçmişi yok.
                                        </div>
                                    )}
                                </div>
                            </details>
                        </CardContent>
                    </Card>
                </div>
            </div>

            <Dialog open={grantConfirmOpen} onOpenChange={setGrantConfirmOpen}>
                <DialogContent>
                    <DialogHeader>
                        <DialogTitle>Grant işlemini onayla</DialogTitle>
                        <DialogDescription>
                            Bu işlem seçili oyuncunun envanterine yeni bir kozmetik ekler ve audit kaydı oluşturur.
                        </DialogDescription>
                    </DialogHeader>
                    <div className="space-y-3 rounded-2xl border border-border/70 bg-muted/15 p-4 text-sm">
                        <div>
                            <span className="font-semibold text-foreground">Oyuncu:</span>{" "}
                            {selectedUser?.displayName || selectedUser?.username || "-"}
                        </div>
                        <div>
                            <span className="font-semibold text-foreground">Item:</span> {selectedGrantItem?.name || "-"}
                        </div>
                        <div>
                            <span className="font-semibold text-foreground">Kod:</span> {selectedGrantItem?.code || "-"}
                        </div>
                        <div>
                            <span className="font-semibold text-foreground">Gerekçe:</span> {grantReason.trim() || "-"}
                        </div>
                    </div>
                    <DialogFooter>
                        <Button variant="outline" onClick={() => setGrantConfirmOpen(false)}>
                            Vazgeç
                        </Button>
                        <Button
                            onClick={() => void submitGrant()}
                            disabled={!selectedUserId || !grantItemId || grantReason.trim().length < 3 || grantSaving}
                        >
                            {grantSaving ? <Loader2 className="h-4 w-4 animate-spin" /> : <Gift className="h-4 w-4" />}
                            Onayla ve Grant Et
                        </Button>
                    </DialogFooter>
                </DialogContent>
            </Dialog>

            <Dialog
                open={Boolean(revokeTarget)}
                onOpenChange={(open) => {
                    if (!open) {
                        setRevokeTarget(null);
                        setRevokeReason("");
                        setRevokeOverrideConfirmed(false);
                    }
                }}
            >
                <DialogContent>
                    <DialogHeader>
                        <DialogTitle>Envanter kaydını kaldır</DialogTitle>
                        <DialogDescription>
                            Bu işlem oyuncunun sahiplik kaydını kaldırır. Kaldırılan item kuşanılıysa ilgili slot da temizlenir.
                        </DialogDescription>
                    </DialogHeader>
                    <div className="space-y-3">
                        <div className="rounded-2xl border border-border/70 bg-muted/15 p-4 text-sm">
                            <div>
                                <span className="font-semibold text-foreground">Oyuncu:</span>{" "}
                                {selectedUser?.displayName || selectedUser?.username || "-"}
                            </div>
                            <div className="mt-2">
                                <span className="font-semibold text-foreground">Item:</span> {revokeTarget?.name || "-"}
                            </div>
                            <div className="mt-2">
                                <span className="font-semibold text-foreground">Kaynak:</span>{" "}
                                {revokeTarget ? sourceLabels[revokeTarget.source] : "-"}
                            </div>
                        </div>
                        {revokeRequiresOverride ? (
                            <div className="rounded-2xl border border-destructive/40 bg-destructive/10 p-4 text-sm text-destructive">
                                <div className="flex items-start gap-2">
                                    <ShieldAlert className="mt-0.5 h-4 w-4 shrink-0" />
                                    <div>
                                        Bu item grant kaynaklı değil. Abuse, iade veya operasyonel müdahale dışında kaldırılmamalı.
                                        Devam etmek için ek onay gerekir.
                                    </div>
                                </div>
                            </div>
                        ) : null}
                        <textarea
                            value={revokeReason}
                            onChange={(event) => setRevokeReason(event.target.value)}
                            rows={3}
                            className="min-h-[96px] w-full resize-y rounded-2xl border border-border bg-background px-3 py-2.5 text-sm outline-none focus:border-primary"
                            placeholder="Kaldırma gerekçesini yaz..."
                        />
                        {revokeRequiresOverride ? (
                            <label className="flex items-start gap-3 rounded-2xl border border-border/70 bg-muted/15 px-4 py-3 text-sm">
                                <input
                                    type="checkbox"
                                    checked={revokeOverrideConfirmed}
                                    onChange={(event) => setRevokeOverrideConfirmed(event.target.checked)}
                                    className="mt-0.5 h-4 w-4 rounded border-border"
                                />
                                <span>Bu korumalı sahiplik kaydını kaldırmayı onaylıyorum.</span>
                            </label>
                        ) : null}
                    </div>
                    <DialogFooter>
                        <Button
                            variant="outline"
                            onClick={() => {
                                setRevokeTarget(null);
                                setRevokeReason("");
                                setRevokeOverrideConfirmed(false);
                            }}
                        >
                            Vazgeç
                        </Button>
                        <Button
                            variant="destructive"
                            onClick={() => void submitRevoke()}
                            disabled={
                                !revokeTarget ||
                                revokeReason.trim().length < 3 ||
                                (revokeRequiresOverride && !revokeOverrideConfirmed) ||
                                revokeSavingId === revokeTarget.inventoryItemId
                            }
                        >
                            {revokeSavingId === revokeTarget?.inventoryItemId ? (
                                <Loader2 className="h-4 w-4 animate-spin" />
                            ) : (
                                <Trash2 className="h-4 w-4" />
                            )}
                            Onayla ve Kaldır
                        </Button>
                    </DialogFooter>
                </DialogContent>
            </Dialog>

            <Dialog
                open={Boolean(resetTargetSlot)}
                onOpenChange={(open) => {
                    if (!open) {
                        setResetTargetSlot(null);
                    }
                }}
            >
                <DialogContent>
                    <DialogHeader>
                        <DialogTitle>Kuşanım slotunu sıfırla</DialogTitle>
                        <DialogDescription>
                            Bu işlem yalnız seçili slotu temizler. Envanter sahipliği silinmez, sadece aktif kuşanım kaldırılır.
                        </DialogDescription>
                    </DialogHeader>
                    <div className="rounded-2xl border border-border/70 bg-muted/15 p-4 text-sm">
                        <div>
                            <span className="font-semibold text-foreground">Oyuncu:</span>{" "}
                            {selectedUser?.displayName || selectedUser?.username || "-"}
                        </div>
                        <div className="mt-2">
                            <span className="font-semibold text-foreground">Slot:</span>{" "}
                            {resetTargetSlot ? slotLabels[resetTargetSlot] : "-"}
                        </div>
                        <div className="mt-2">
                            <span className="font-semibold text-foreground">Mevcut Item:</span> {resetTargetItem?.name || "Boş"}
                        </div>
                    </div>
                    <DialogFooter>
                        <Button variant="outline" onClick={() => setResetTargetSlot(null)}>
                            Vazgeç
                        </Button>
                        <Button
                            onClick={() => void submitEquipReset()}
                            disabled={!resetTargetSlot || resettingSlot === resetTargetSlot}
                        >
                            {resettingSlot === resetTargetSlot ? <Loader2 className="h-4 w-4 animate-spin" /> : null}
                            Onayla ve Sıfırla
                        </Button>
                    </DialogFooter>
                </DialogContent>
            </Dialog>
        </div>
    );
}
