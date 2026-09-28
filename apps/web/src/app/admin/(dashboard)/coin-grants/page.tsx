"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import {
    Archive,
    BadgeDollarSign,
    ChevronDown,
    ChevronUp,
    Clock3,
    Gift,
    Hash,
    Plus,
    Search,
    ShieldCheck,
    Sparkles,
    Trash2,
    Users,
} from "lucide-react";
import { AdminPageHeader } from "@/components/admin/admin-page-header";
import { AdminToolbar, AdminToolbarStats } from "@/components/admin/admin-toolbar";
import { AdminEmptyState, AdminTableShell } from "@/components/admin/admin-table-shell";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import type { CoinGrantCampaignView, CoinGrantCodeView } from "@/types/coin-grants";

interface CampaignFormState {
    code: string;
    name: string;
    description: string;
    coinAmount: string;
    totalBudgetCoin: string;
    totalClaimLimit: string;
    perUserClaimLimit: string;
    startsAt: string;
    endsAt: string;
    isActive: boolean;
}

interface CodeFormState {
    campaignId: string;
    label: string;
    manualCode: string;
    prefix: string;
    quantity: string;
    maxClaims: string;
    expiresAt: string;
    isActive: boolean;
}

type CampaignViewFilter = "all" | "active" | "inactive" | "used" | "exhausted" | "archived";

const inputClassName = "w-full rounded-2xl border border-border/80 bg-background px-3 py-2.5 text-sm text-foreground outline-none transition focus:border-amber-500";
const sectionClassName = "space-y-4 rounded-[26px] border border-border/80 bg-background/90 p-5";
const emptyCampaignForm: CampaignFormState = {
    code: "",
    name: "",
    description: "",
    coinAmount: "100",
    totalBudgetCoin: "",
    totalClaimLimit: "",
    perUserClaimLimit: "1",
    startsAt: "",
    endsAt: "",
    isActive: true,
};

const emptyCodeForm: CodeFormState = {
    campaignId: "",
    label: "",
    manualCode: "",
    prefix: "",
    quantity: "1",
    maxClaims: "1",
    expiresAt: "",
    isActive: true,
};

function toDateTimeLocal(iso: string | null): string {
    if (!iso) return "";
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

function formatDateTime(value: string | null): string {
    if (!value) {
        return "Açık uçlu";
    }

    return new Date(value).toLocaleString("tr-TR", {
        dateStyle: "short",
        timeStyle: "short",
    });
}

function isCampaignUsed(campaign: CoinGrantCampaignView): boolean {
    return campaign.totalClaimCount > 0 || campaign.totalGrantedCoin > 0 || campaign.codes.some((code) => code.claimCount > 0);
}

function isCampaignExhausted(campaign: CoinGrantCampaignView): boolean {
    const budgetReached =
        campaign.totalBudgetCoin !== null && campaign.totalGrantedCoin >= campaign.totalBudgetCoin;
    const claimLimitReached =
        campaign.totalClaimLimit !== null && campaign.totalClaimCount >= campaign.totalClaimLimit;
    return budgetReached || claimLimitReached;
}

function isCampaignArchived(campaign: CoinGrantCampaignView): boolean {
    return campaign.archivedAt !== null;
}

function matchesCampaignFilter(campaign: CoinGrantCampaignView, viewFilter: CampaignViewFilter): boolean {
    const archived = isCampaignArchived(campaign);

    switch (viewFilter) {
        case "active":
            return !archived && campaign.isActive;
        case "inactive":
            return !archived && !campaign.isActive;
        case "used":
            return !archived && isCampaignUsed(campaign);
        case "exhausted":
            return !archived && isCampaignExhausted(campaign);
        case "archived":
            return archived;
        default:
            return !archived;
    }
}

function matchesCodeSearch(code: CoinGrantCodeView, needle: string): boolean {
    if (!needle) {
        return true;
    }

    return [code.code, code.label ?? ""].join(" ").toLowerCase().includes(needle);
}

function StatChip({
    icon: Icon,
    label,
    value,
}: {
    icon: typeof Gift;
    label: string;
    value: string;
}) {
    return (
        <div className="rounded-2xl border border-border/70 bg-muted/25 px-3 py-2">
            <div className="flex items-center gap-2 text-[10px] font-black uppercase tracking-[0.18em] text-muted-foreground">
                <Icon className="h-3.5 w-3.5" />
                {label}
            </div>
            <div className="mt-1 text-sm font-semibold text-foreground">{value}</div>
        </div>
    );
}

function SectionLabel({
    title,
    description,
}: {
    title: string;
    description: string;
}) {
    return (
        <div>
            <div className="text-xs font-black uppercase tracking-[0.18em] text-muted-foreground">{title}</div>
            <p className="mt-1 text-sm text-muted-foreground">{description}</p>
        </div>
    );
}

export default function AdminCoinGrantsPage() {
    const [campaigns, setCampaigns] = useState<CoinGrantCampaignView[]>([]);
    const [search, setSearch] = useState("");
    const [loading, setLoading] = useState(true);
    const [saving, setSaving] = useState(false);
    const [error, setError] = useState<string | null>(null);
    const [notice, setNotice] = useState<string | null>(null);
    const [editingCampaignId, setEditingCampaignId] = useState<number | null>(null);
    const [deactivatingCampaignId, setDeactivatingCampaignId] = useState<number | null>(null);
    const [deactivatingCodeId, setDeactivatingCodeId] = useState<number | null>(null);
    const [archivingCampaignId, setArchivingCampaignId] = useState<number | null>(null);
    const [archivingCodeId, setArchivingCodeId] = useState<number | null>(null);
    const [viewFilter, setViewFilter] = useState<CampaignViewFilter>("all");
    const [expandedCampaignIds, setExpandedCampaignIds] = useState<number[]>([]);
    const [campaignForm, setCampaignForm] = useState<CampaignFormState>(emptyCampaignForm);
    const [codeForm, setCodeForm] = useState<CodeFormState>(emptyCodeForm);

    const loadCampaigns = useCallback(async () => {
        setLoading(true);
        setError(null);
        try {
            const response = await fetch("/api/admin/coin-grants/campaigns", { cache: "no-store" });
            if (!response.ok) {
                setError("Coin grant verileri yüklenemedi.");
                return;
            }

            const payload = (await response.json()) as CoinGrantCampaignView[];
            setCampaigns(payload);
            setCodeForm((current) => {
                const currentStillEligible = payload.some(
                    (campaign) =>
                        String(campaign.id) === current.campaignId &&
                        campaign.isActive &&
                        !campaign.archivedAt
                );
                const nextEligible = payload.find((campaign) => campaign.isActive && !campaign.archivedAt);

                return {
                    ...current,
                    campaignId: currentStillEligible
                        ? current.campaignId
                        : nextEligible
                            ? String(nextEligible.id)
                            : "",
                };
            });
        } catch {
            setError("Coin grant verileri yüklenemedi.");
        } finally {
            setLoading(false);
        }
    }, []);

    useEffect(() => {
        void loadCampaigns();
    }, [loadCampaigns]);

    const searchNeedle = useMemo(() => search.trim().toLowerCase(), [search]);

    const filteredCampaigns = useMemo(() => {
        return campaigns.filter((campaign) => {
            const matchesSearch =
                !searchNeedle ||
                [campaign.code, campaign.name, campaign.description ?? "", ...campaign.codes.map((code) => `${code.code} ${code.label ?? ""}`)]
                    .join(" ")
                    .toLowerCase()
                    .includes(searchNeedle);

            if (!matchesSearch) {
                return false;
            }

            return matchesCampaignFilter(campaign, viewFilter);
        });
    }, [campaigns, searchNeedle, viewFilter]);

    const operationalCampaigns = useMemo(
        () => campaigns.filter((campaign) => !campaign.archivedAt),
        [campaigns]
    );

    const eligibleCodeCampaigns = useMemo(
        () => campaigns.filter((campaign) => campaign.isActive && !campaign.archivedAt),
        [campaigns]
    );

    const operationalCodeCount = useMemo(
        () =>
            operationalCampaigns.reduce(
                (sum, campaign) => sum + campaign.codes.filter((code) => !code.archivedAt).length,
                0
            ),
        [operationalCampaigns]
    );

    const archivedCodeCount = useMemo(
        () => campaigns.reduce((sum, campaign) => sum + campaign.codes.filter((code) => code.archivedAt).length, 0),
        [campaigns]
    );

    const stats = useMemo(
        () => [
            { label: "operasyonel kampanya", value: String(operationalCampaigns.length) },
            { label: "operasyonel kod", value: String(operationalCodeCount) },
            { label: "arşivli kod", value: String(archivedCodeCount) },
            {
                label: "dağıtılan coin",
                value: String(operationalCampaigns.reduce((sum, campaign) => sum + campaign.totalGrantedCoin, 0)),
            },
        ],
        [archivedCodeCount, operationalCampaigns, operationalCodeCount]
    );

    const tableDescription = useMemo(() => {
        switch (viewFilter) {
            case "archived":
                return "Arşivlenen kampanya ve kodlar burada tutulur. Geri alma işlemi kampanyayı pasif olarak geri açar.";
            case "active":
                return "Yayında olan kampanyalar ve onlara bağlı operasyonel kodlar burada izlenir.";
            case "inactive":
                return "Pasife alınmış ama henüz arşivlenmemiş kampanyalar burada listelenir.";
            case "used":
                return "En az bir claim almış kampanyalar ve bağlı kod performansı burada görünür.";
            case "exhausted":
                return "Bütçe veya claim limiti tükenen kampanyalar burada izlenir.";
            default:
                return "Arşiv dışındaki operasyonel kampanyalar, kod durumu ve claim yoğunluğu buradan takip edilir.";
        }
    }, [viewFilter]);

    const emptyState = useMemo(() => {
        if (viewFilter === "archived") {
            return {
                title: "Arşivde coin grant yok",
                description: "Arşive kaldırılan kampanya ve kodlar burada görünür. Şu an geri alınacak bir kayıt bulunmuyor.",
            };
        }

        return {
            title: "Coin grant kampanyası yok",
            description: "Yeni bir kampanya açarak etkinlik ödülü, içerik üretici kodu veya topluluk dağıtımı hazırlayabilirsin.",
        };
    }, [viewFilter]);

    const submitCampaign = async () => {
        setSaving(true);
        setNotice(null);
        try {
            const payload = {
                code: campaignForm.code.trim().toUpperCase(),
                name: campaignForm.name.trim(),
                description: campaignForm.description.trim() || null,
                coinAmount: Number.parseInt(campaignForm.coinAmount, 10),
                totalBudgetCoin: toNullableInt(campaignForm.totalBudgetCoin),
                totalClaimLimit: toNullableInt(campaignForm.totalClaimLimit),
                perUserClaimLimit: Number.parseInt(campaignForm.perUserClaimLimit, 10),
                startsAt: toIsoDateTime(campaignForm.startsAt),
                endsAt: toIsoDateTime(campaignForm.endsAt),
                isActive: campaignForm.isActive,
            };

            const response = await fetch(
                editingCampaignId ? `/api/admin/coin-grants/campaigns/${editingCampaignId}` : "/api/admin/coin-grants/campaigns",
                {
                    method: editingCampaignId ? "PUT" : "POST",
                    headers: { "Content-Type": "application/json" },
                    body: JSON.stringify(payload),
                }
            );

            if (!response.ok) {
                const errorPayload = (await response.json().catch(() => ({ error: "Kampanya kaydedilemedi." }))) as { error?: string };
                window.alert(errorPayload.error || "Kampanya kaydedilemedi.");
                return;
            }

            setEditingCampaignId(null);
            setCampaignForm(emptyCampaignForm);
            setNotice(editingCampaignId ? "Kampanya güncellendi." : "Kampanya oluşturuldu.");
            await loadCampaigns();
        } finally {
            setSaving(false);
        }
    };

    const submitCodes = async () => {
        if (!eligibleCodeCampaigns.some((campaign) => String(campaign.id) === codeForm.campaignId)) {
            setError("Kod üretimi için aktif ve arşivlenmemiş bir kampanya seç.");
            return;
        }

        setSaving(true);
        setNotice(null);
        setError(null);
        try {
            const payload = {
                campaignId: Number.parseInt(codeForm.campaignId, 10),
                label: codeForm.label.trim() || null,
                manualCode: codeForm.manualCode.trim() ? codeForm.manualCode.trim().toUpperCase() : null,
                prefix: codeForm.prefix.trim() ? codeForm.prefix.trim().toUpperCase() : null,
                quantity: Number.parseInt(codeForm.quantity, 10),
                maxClaims: toNullableInt(codeForm.maxClaims),
                expiresAt: toIsoDateTime(codeForm.expiresAt),
                isActive: codeForm.isActive,
            };

            const response = await fetch("/api/admin/coin-grants/codes", {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify(payload),
            });

            if (!response.ok) {
                const errorPayload = (await response.json().catch(() => ({ error: "Kodlar oluşturulamadı." }))) as { error?: string };
                window.alert(errorPayload.error || "Kodlar oluşturulamadı.");
                return;
            }

            setCodeForm((current) => ({ ...emptyCodeForm, campaignId: current.campaignId }));
            setNotice("Kodlar oluşturuldu.");
            await loadCampaigns();
        } finally {
            setSaving(false);
        }
    };

    const editCampaign = (campaign: CoinGrantCampaignView) => {
        if (campaign.archivedAt) {
            setError("Arşivli kampanya düzenlenemez.");
            return;
        }

        setEditingCampaignId(campaign.id);
        setCampaignForm({
            code: campaign.code,
            name: campaign.name,
            description: campaign.description ?? "",
            coinAmount: String(campaign.coinAmount),
            totalBudgetCoin: campaign.totalBudgetCoin !== null ? String(campaign.totalBudgetCoin) : "",
            totalClaimLimit: campaign.totalClaimLimit !== null ? String(campaign.totalClaimLimit) : "",
            perUserClaimLimit: String(campaign.perUserClaimLimit),
            startsAt: toDateTimeLocal(campaign.startsAt),
            endsAt: toDateTimeLocal(campaign.endsAt),
            isActive: campaign.isActive,
        });
    };

    const deactivateCampaign = async (campaign: CoinGrantCampaignView) => {
        if (!campaign.isActive) {
            setNotice("Bu kampanya zaten pasif.");
            return;
        }

        setNotice(null);
        setDeactivatingCampaignId(campaign.id);
        try {
            const response = await fetch(`/api/admin/coin-grants/campaigns/${campaign.id}`, { method: "DELETE" });
            if (!response.ok) {
                const errorPayload = (await response.json().catch(() => ({ error: "Kampanya pasife alınamadı." }))) as { error?: string };
                setError(errorPayload.error || "Kampanya pasife alınamadı.");
                return;
            }

            await response.json().catch(() => ({ ok: true, outcome: "deactivated" }));

            setCampaigns((current) =>
                current.map((entry) =>
                    entry.id === campaign.id
                        ? { ...entry, isActive: false, updatedAt: new Date().toISOString() }
                        : entry
                )
            );
            setNotice(`${campaign.name} pasife alındı.`);
            await loadCampaigns();
        } finally {
            setDeactivatingCampaignId(null);
        }
    };

    const deactivateCode = async (campaignId: number, codeId: number) => {
        const parentCampaign = campaigns.find((campaign) => campaign.id === campaignId);
        const code = parentCampaign?.codes.find((entry) => entry.id === codeId);
        if (code && !code.isActive) {
            setNotice("Bu kod zaten pasif.");
            return;
        }

        setNotice(null);
        setDeactivatingCodeId(codeId);
        try {
            const response = await fetch(`/api/admin/coin-grants/codes/${codeId}`, { method: "DELETE" });
            if (!response.ok) {
                const errorPayload = (await response.json().catch(() => ({ error: "Kod pasife alınamadı." }))) as { error?: string };
                setError(errorPayload.error || "Kod pasife alınamadı.");
                return;
            }

            await response.json().catch(() => ({ ok: true, outcome: "deactivated" }));

            setCampaigns((current) =>
                current.map((campaign) =>
                    campaign.id === campaignId
                        ? {
                            ...campaign,
                            codes: campaign.codes.map((entry) =>
                                entry.id === codeId ? { ...entry, isActive: false } : entry
                            ),
                        }
                        : campaign
                )
            );
            setNotice("Kod pasife alındı.");
            await loadCampaigns();
        } finally {
            setDeactivatingCodeId(null);
        }
    };

    const archiveCampaign = async (campaign: CoinGrantCampaignView) => {
        if (campaign.archivedAt) {
            setNotice("Bu kampanya zaten arşivde.");
            return;
        }
        if (campaign.isActive) {
            setError("Kampanya arşivlenmeden önce pasife alınmalı.");
            return;
        }

        setError(null);
        setNotice(null);
        setArchivingCampaignId(campaign.id);
        try {
            const response = await fetch(`/api/admin/coin-grants/campaigns/${campaign.id}/archive`, { method: "POST" });
            if (!response.ok) {
                const errorPayload = (await response.json().catch(() => ({ error: "Kampanya arşivlenemedi." }))) as { error?: string };
                setError(errorPayload.error || "Kampanya arşivlenemedi.");
                return;
            }

            setCampaigns((current) =>
                current.map((entry) =>
                    entry.id === campaign.id
                        ? { ...entry, archivedAt: new Date().toISOString() }
                        : entry
                )
            );
            setNotice(`${campaign.name} arşive kaldırıldı.`);
            await loadCampaigns();
        } finally {
            setArchivingCampaignId(null);
        }
    };

    const restoreCampaign = async (campaign: CoinGrantCampaignView) => {
        if (!campaign.archivedAt) {
            setNotice("Bu kampanya zaten operasyonel listede.");
            return;
        }

        setError(null);
        setNotice(null);
        setArchivingCampaignId(campaign.id);
        try {
            const response = await fetch(`/api/admin/coin-grants/campaigns/${campaign.id}/restore`, { method: "POST" });
            if (!response.ok) {
                const errorPayload = (await response.json().catch(() => ({ error: "Kampanya geri alınamadı." }))) as { error?: string };
                setError(errorPayload.error || "Kampanya geri alınamadı.");
                return;
            }

            setCampaigns((current) =>
                current.map((entry) =>
                    entry.id === campaign.id
                        ? { ...entry, archivedAt: null, isActive: false }
                        : entry
                )
            );
            setNotice(`${campaign.name} arşivden çıkarıldı.`);
            await loadCampaigns();
        } finally {
            setArchivingCampaignId(null);
        }
    };

    const archiveCode = async (campaignId: number, codeId: number) => {
        const parentCampaign = campaigns.find((campaign) => campaign.id === campaignId);
        const code = parentCampaign?.codes.find((entry) => entry.id === codeId);
        if (code?.archivedAt) {
            setNotice("Bu kod zaten arşivde.");
            return;
        }
        if (code?.isActive) {
            setError("Kod arşivlenmeden önce pasife alınmalı.");
            return;
        }

        setError(null);
        setNotice(null);
        setArchivingCodeId(codeId);
        try {
            const response = await fetch(`/api/admin/coin-grants/codes/${codeId}/archive`, { method: "POST" });
            if (!response.ok) {
                const errorPayload = (await response.json().catch(() => ({ error: "Kod arşivlenemedi." }))) as { error?: string };
                setError(errorPayload.error || "Kod arşivlenemedi.");
                return;
            }

            setCampaigns((current) =>
                current.map((campaign) =>
                    campaign.id === campaignId
                        ? {
                            ...campaign,
                            codes: campaign.codes.map((entry) =>
                                entry.id === codeId ? { ...entry, archivedAt: new Date().toISOString() } : entry
                            ),
                        }
                        : campaign
                )
            );
            setNotice("Kod arşive kaldırıldı.");
            await loadCampaigns();
        } finally {
            setArchivingCodeId(null);
        }
    };

    const restoreCode = async (campaignId: number, codeId: number) => {
        const parentCampaign = campaigns.find((campaign) => campaign.id === campaignId);
        const code = parentCampaign?.codes.find((entry) => entry.id === codeId);
        if (!code?.archivedAt) {
            setNotice("Bu kod zaten operasyonel listede.");
            return;
        }

        setError(null);
        setNotice(null);
        setArchivingCodeId(codeId);
        try {
            const response = await fetch(`/api/admin/coin-grants/codes/${codeId}/restore`, { method: "POST" });
            if (!response.ok) {
                const errorPayload = (await response.json().catch(() => ({ error: "Kod geri alınamadı." }))) as { error?: string };
                setError(errorPayload.error || "Kod geri alınamadı.");
                return;
            }

            setCampaigns((current) =>
                current.map((campaign) =>
                    campaign.id === campaignId
                        ? {
                            ...campaign,
                            codes: campaign.codes.map((entry) =>
                                entry.id === codeId ? { ...entry, archivedAt: null, isActive: false } : entry
                            ),
                        }
                        : campaign
                )
            );
            setNotice("Kod arşivden çıkarıldı.");
            await loadCampaigns();
        } finally {
            setArchivingCodeId(null);
        }
    };

    const toggleCampaignDetails = (campaignId: number) => {
        setExpandedCampaignIds((current) =>
            current.includes(campaignId)
                ? current.filter((entry) => entry !== campaignId)
                : [...current, campaignId]
        );
    };
    return (
        <div className="space-y-6">
            <AdminPageHeader
                title="Coin Grants"
                description="İçerik üretici kodu, etkinlik ödülü veya toplu coin dağıtımı için kontrollü operasyon paneli."
                meta={`${operationalCampaigns.length} operasyonel kampanya`}
                icon={<Gift className="h-5 w-5 text-amber-500" />}
            />

            <AdminToolbar>
                <div className="relative flex-1">
                    <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
                    <Input
                        value={search}
                        onChange={(event) => setSearch(event.target.value)}
                        placeholder="Kampanya, açıklama veya kod ara..."
                        className="pl-9"
                    />
                </div>
                <AdminToolbarStats stats={stats} />
            </AdminToolbar>

            {error ? (
                <div className="rounded-2xl border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-600">
                    {error}
                </div>
            ) : null}
            {notice ? (
                <div className="rounded-2xl border border-emerald-200 bg-emerald-50 px-4 py-3 text-sm text-emerald-700">
                    {notice}
                </div>
            ) : null}

            <div className="flex flex-wrap gap-2">
                {([
                    ["all", "Tüm operasyonel"],
                    ["active", "Aktif"],
                    ["inactive", "Pasif"],
                    ["used", "Kullanilan"],
                    ["exhausted", "Tukenen"],
                    ["archived", "Arsiv"],
                ] as Array<[CampaignViewFilter, string]>).map(([key, label]) => (
                    <Button
                        key={key}
                        type="button"
                        variant={viewFilter === key ? "default" : "outline"}
                        size="sm"
                        onClick={() => setViewFilter(key)}
                    >
                        {label}
                    </Button>
                ))}
            </div>

            <div className="grid gap-6 xl:grid-cols-[1.2fr_0.8fr]">
                <AdminTableShell
                    title="Dağıtım Kampanyaları"
                    description={tableDescription}
                    loading={loading}
                    isEmpty={!loading && filteredCampaigns.length === 0}
                    emptyState={
                        <AdminEmptyState
                            icon={<Gift className="h-6 w-6" />}
                            title={emptyState.title}
                            description={emptyState.description}
                        />
                    }
                >
                    <div className="space-y-4 p-4">
                        {filteredCampaigns.map((campaign) => {
                            const scopedCodes = campaign.codes.filter((code) =>
                                viewFilter === "archived" ? Boolean(code.archivedAt) : !code.archivedAt
                            );
                            const matchingCodes = searchNeedle
                                ? scopedCodes.filter((code) => matchesCodeSearch(code, searchNeedle))
                                : scopedCodes;
                            const visibleCodes = matchingCodes.length > 0 ? matchingCodes : scopedCodes;
                            const isExpanded = expandedCampaignIds.includes(campaign.id);
                            const activeCodeCount = campaign.codes.filter((code) => code.isActive && !code.archivedAt).length;
                            const inactiveCodeCount = campaign.codes.filter((code) => !code.isActive && !code.archivedAt).length;
                            const archivedCampaignCodeCount = campaign.codes.filter((code) => code.archivedAt).length;
                            const showingFilteredCodes = Boolean(searchNeedle) && matchingCodes.length > 0 && matchingCodes.length !== scopedCodes.length;

                            return (
                                <article key={campaign.id} className="rounded-[28px] border border-border/80 bg-background/90 p-4 shadow-sm">
                                    <div className="flex flex-col gap-4 xl:flex-row xl:items-start xl:justify-between">
                                        <div className="min-w-0 flex-1">
                                            <div className="flex flex-wrap items-center gap-2">
                                                <h3 className="text-lg font-semibold text-foreground">{campaign.name}</h3>
                                                <span
                                                    className={`rounded-full px-2.5 py-1 text-[10px] font-black uppercase tracking-[0.18em] ${campaign.isActive ? "bg-emerald-100 text-emerald-700" : "bg-zinc-200 text-zinc-700"}`}
                                                >
                                                    {campaign.isActive ? "aktif" : "pasif"}
                                                </span>
                                                {campaign.archivedAt ? (
                                                    <span className="rounded-full bg-violet-100 px-2.5 py-1 text-[10px] font-black uppercase tracking-[0.18em] text-violet-700">
                                                        arşiv
                                                    </span>
                                                ) : null}
                                                {isCampaignUsed(campaign) ? (
                                                    <span className="rounded-full bg-sky-100 px-2.5 py-1 text-[10px] font-black uppercase tracking-[0.18em] text-sky-700">
                                                        kullanıldı
                                                    </span>
                                                ) : null}
                                                {isCampaignExhausted(campaign) ? (
                                                    <span className="rounded-full bg-amber-100 px-2.5 py-1 text-[10px] font-black uppercase tracking-[0.18em] text-amber-700">
                                                        tükendi
                                                    </span>
                                                ) : null}
                                            </div>
                                            <div className="mt-1 flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-muted-foreground">
                                                <span className="font-mono">{campaign.code}</span>
                                                <span>{campaign.coinAmount.toLocaleString("tr-TR")} coin / claim</span>
                                                <span>{campaign.totalClaimCount.toLocaleString("tr-TR")} claim</span>
                                                <span>{activeCodeCount} aktif kod</span>
                                            </div>
                                            <p className="mt-2 max-w-2xl text-sm leading-6 text-muted-foreground">
                                                {campaign.description || "Bu kampanya için ayrı bir açıklama girilmemiş."}
                                            </p>
                                        </div>
                                        <div className="flex flex-wrap gap-2 xl:justify-end">
                                            <Button variant="outline" size="sm" onClick={() => toggleCampaignDetails(campaign.id)}>
                                                {isExpanded ? <ChevronUp size={14} /> : <ChevronDown size={14} />}
                                                <span>{isExpanded ? "Detayı kapat" : "Detayı aç"}</span>
                                            </Button>
                                            <Button
                                                variant="outline"
                                                size="sm"
                                                disabled={Boolean(campaign.archivedAt)}
                                                onClick={() => editCampaign(campaign)}
                                            >
                                                Düzenle
                                            </Button>
                                            <Button
                                                variant="ghost"
                                                size="sm"
                                                disabled={deactivatingCampaignId === campaign.id || !campaign.isActive || Boolean(campaign.archivedAt)}
                                                onClick={() => void deactivateCampaign(campaign)}
                                            >
                                                <Trash2 size={14} />
                                                <span className="ml-2">{campaign.isActive ? "Pasife al" : "Pasif"}</span>
                                            </Button>
                                            {campaign.archivedAt ? (
                                                <Button
                                                    variant="ghost"
                                                    size="sm"
                                                    disabled={archivingCampaignId === campaign.id}
                                                    onClick={() => void restoreCampaign(campaign)}
                                                >
                                                    <Archive size={14} />
                                                    <span className="ml-2">{archivingCampaignId === campaign.id ? "Geri alınıyor" : "Arşivden çıkar"}</span>
                                                </Button>
                                            ) : (
                                                <Button
                                                    variant="ghost"
                                                    size="sm"
                                                    disabled={archivingCampaignId === campaign.id || campaign.isActive}
                                                    onClick={() => void archiveCampaign(campaign)}
                                                >
                                                    <Archive size={14} />
                                                    <span className="ml-2">{archivingCampaignId === campaign.id ? "Arşivleniyor" : "Arşive kaldır"}</span>
                                                </Button>
                                            )}
                                        </div>
                                    </div>

                                    <div className="mt-4 grid gap-3 md:grid-cols-2 xl:grid-cols-4">
                                        <StatChip icon={BadgeDollarSign} label="coin / claim" value={campaign.coinAmount.toLocaleString("tr-TR")} />
                                        <StatChip
                                            icon={Gift}
                                            label="dağıtılan / bütçe"
                                            value={`${campaign.totalGrantedCoin.toLocaleString("tr-TR")} / ${campaign.totalBudgetCoin !== null ? campaign.totalBudgetCoin.toLocaleString("tr-TR") : "limitsiz"}`}
                                        />
                                        <StatChip
                                            icon={Hash}
                                            label="claim / limit"
                                            value={`${campaign.totalClaimCount.toLocaleString("tr-TR")} / ${campaign.totalClaimLimit !== null ? campaign.totalClaimLimit.toLocaleString("tr-TR") : "limitsiz"}`}
                                        />
                                        <StatChip icon={Users} label="kullanıcı başı" value={String(campaign.perUserClaimLimit)} />
                                    </div>

                                    <div className="mt-4 rounded-2xl border border-border/70 bg-muted/15 px-3 py-3">
                                        <div className="flex flex-wrap items-center gap-2 text-[11px] font-black uppercase tracking-[0.18em] text-muted-foreground">
                                            <span>Kod özeti</span>
                                            <span className="rounded-full bg-emerald-100 px-2 py-1 text-emerald-700">{activeCodeCount} aktif</span>
                                            <span className="rounded-full bg-zinc-200 px-2 py-1 text-zinc-700">{inactiveCodeCount} pasif</span>
                                            {archivedCampaignCodeCount > 0 ? (
                                                <span className="rounded-full bg-violet-100 px-2 py-1 text-violet-700">{archivedCampaignCodeCount} arşivli</span>
                                            ) : null}
                                        </div>
                                        <p className="mt-2 text-sm text-muted-foreground">
                                            {showingFilteredCodes
                                                ? `${visibleCodes.length} kod arama ile eşleşti. Kampanyada toplam ${scopedCodes.length} görünür kod var.`
                                                : `${visibleCodes.length} görünür kod bu kampanya altında listeleniyor.`}
                                        </p>
                                    </div>

                                    {isExpanded ? (
                                        <>
                                            <div className="mt-4 grid gap-3 md:grid-cols-2">
                                                <div className="rounded-2xl border border-border/70 bg-muted/20 p-3 text-sm text-muted-foreground">
                                                    <div className="mb-1 flex items-center gap-2 text-[10px] font-black uppercase tracking-[0.18em] text-muted-foreground">
                                                        <Clock3 className="h-3.5 w-3.5" />
                                                        Kampanya takvimi
                                                    </div>
                                                    <div>Başlangıç: {formatDateTime(campaign.startsAt)}</div>
                                                    <div>Bitiş: {formatDateTime(campaign.endsAt)}</div>
                                                </div>
                                                <div className="rounded-2xl border border-border/70 bg-muted/20 p-3 text-sm text-muted-foreground">
                                                    <div className="mb-1 flex items-center gap-2 text-[10px] font-black uppercase tracking-[0.18em] text-muted-foreground">
                                                        <ShieldCheck className="h-3.5 w-3.5" />
                                                        Dağıtım notu
                                                    </div>
                                                    <div>Kampanya claim, bütçe ve kullanıcı limiti server transaction&apos;ı içinde enforce edilir.</div>
                                                </div>
                                            </div>

                                            <div className="mt-4 rounded-2xl border border-border/70 bg-muted/15 p-3">
                                                <div className="flex items-center gap-2 text-[10px] font-black uppercase tracking-[0.18em] text-muted-foreground">
                                                    <Sparkles className="h-3.5 w-3.5" />
                                                    Dağıtım kodları
                                                </div>
                                                <div className="mt-3 space-y-2">
                                                    {visibleCodes.length === 0 ? (
                                                        <span className="text-sm text-muted-foreground">Bu kampanya için henüz kod üretilmemiş.</span>
                                                    ) : (
                                                        visibleCodes.map((code) => (
                                                            <div key={code.id} className="flex flex-col gap-3 rounded-2xl border border-border/70 bg-background/80 px-3 py-3 md:flex-row md:items-center md:justify-between">
                                                                <div className="min-w-0">
                                                                    <div className="flex flex-wrap items-center gap-2">
                                                                        <span className="font-mono text-sm font-semibold text-foreground">{code.code}</span>
                                                                        {!code.isActive ? <span className="rounded-full bg-amber-100 px-2 py-1 text-[10px] font-black uppercase tracking-[0.18em] text-amber-700">pasif</span> : null}
                                                                        {code.archivedAt ? <span className="rounded-full bg-violet-100 px-2 py-1 text-[10px] font-black uppercase tracking-[0.18em] text-violet-700">arşiv</span> : null}
                                                                    </div>
                                                                    <div className="mt-1 flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-muted-foreground">
                                                                        <span>{code.claimCount}{code.maxClaims !== null ? ` / ${code.maxClaims}` : " / limitsiz"} claim</span>
                                                                        {code.label ? <span>{code.label}</span> : null}
                                                                        <span>Oluşturma: {formatDateTime(code.createdAt)}</span>
                                                                    </div>
                                                                </div>
                                                                <div className="flex shrink-0 gap-2">
                                                                    {code.archivedAt ? (
                                                                        <Button
                                                                            type="button"
                                                                            variant="outline"
                                                                            size="sm"
                                                                            disabled={archivingCodeId === code.id}
                                                                            onClick={() => void restoreCode(campaign.id, code.id)}
                                                                        >
                                                                            {archivingCodeId === code.id ? "Geri alınıyor" : "Arşivden çıkar"}
                                                                        </Button>
                                                                    ) : code.isActive ? (
                                                                        <Button
                                                                            type="button"
                                                                            variant="outline"
                                                                            size="sm"
                                                                            disabled={deactivatingCodeId === code.id}
                                                                            onClick={() => void deactivateCode(campaign.id, code.id)}
                                                                        >
                                                                            {deactivatingCodeId === code.id ? "Pasife alınıyor" : "Pasife al"}
                                                                        </Button>
                                                                    ) : (
                                                                        <Button
                                                                            type="button"
                                                                            variant="outline"
                                                                            size="sm"
                                                                            disabled={archivingCodeId === code.id}
                                                                            onClick={() => void archiveCode(campaign.id, code.id)}
                                                                        >
                                                                            {archivingCodeId === code.id ? "Arşivleniyor" : "Arşive kaldır"}
                                                                        </Button>
                                                                    )}
                                                                </div>
                                                            </div>
                                                        ))
                                                    )}
                                                </div>
                                            </div>
                                        </>
                                    ) : null}
                                </article>
                            );
                        })}
                    </div>
                </AdminTableShell>

                <div className="space-y-6">
                    <div className="rounded-[30px] border border-border/80 bg-gradient-to-br from-amber-50/90 via-white to-orange-50/80 p-5 shadow-sm dark:from-amber-950/20 dark:via-background dark:to-orange-950/10">
                        <div className="flex items-start justify-between gap-4">
                            <div>
                                <h3 className="text-lg font-semibold text-foreground">
                                    {editingCampaignId ? "Kampanya düzenle" : "Yeni kampanya"}
                                </h3>
                                <p className="mt-1 text-sm text-muted-foreground">
                                    Burada coin miktarını, toplam bütçeyi ve kampanya kapsamındaki claim kurallarını belirliyorsun.
                                </p>
                            </div>
                            <Button variant="outline" size="sm" onClick={() => { setEditingCampaignId(null); setCampaignForm(emptyCampaignForm); }}>
                                <Plus size={14} className="mr-1" /> Yeni
                            </Button>
                        </div>

                        <div className="mt-5 space-y-4">
                            <div className={sectionClassName}>
                                <SectionLabel title="Kimlik" description="Kod, audit log ve operasyon takibinde kampanyanın ana referansı olur." />
                                <div className="grid gap-3 md:grid-cols-2">
                                    <input className={inputClassName} placeholder="Kampanya kodu" value={campaignForm.code} onChange={(event) => setCampaignForm((current) => ({ ...current, code: event.target.value }))} />
                                    <input className={inputClassName} placeholder="Kampanya adı" value={campaignForm.name} onChange={(event) => setCampaignForm((current) => ({ ...current, name: event.target.value }))} />
                                </div>
                                <textarea className={`${inputClassName} min-h-[88px] resize-y`} placeholder="Bu kampanya ne için kullanılıyor?" value={campaignForm.description} onChange={(event) => setCampaignForm((current) => ({ ...current, description: event.target.value }))} />
                            </div>

                            <div className={sectionClassName}>
                                <SectionLabel title="Ekonomi kuralları" description="Coin miktarı ve toplam dağıtım üst limitleri burada tanımlanır." />
                                <div className="grid gap-3 md:grid-cols-2">
                                    <input className={inputClassName} type="number" min="1" placeholder="Claim başına coin" value={campaignForm.coinAmount} onChange={(event) => setCampaignForm((current) => ({ ...current, coinAmount: event.target.value }))} />
                                    <input className={inputClassName} type="number" min="1" placeholder="Kullanıcı başı claim limiti" value={campaignForm.perUserClaimLimit} onChange={(event) => setCampaignForm((current) => ({ ...current, perUserClaimLimit: event.target.value }))} />
                                </div>
                                <div className="grid gap-3 md:grid-cols-2">
                                    <input className={inputClassName} type="number" min="1" placeholder="Toplam bütçe coin (opsiyonel)" value={campaignForm.totalBudgetCoin} onChange={(event) => setCampaignForm((current) => ({ ...current, totalBudgetCoin: event.target.value }))} />
                                    <input className={inputClassName} type="number" min="1" placeholder="Toplam claim limiti (opsiyonel)" value={campaignForm.totalClaimLimit} onChange={(event) => setCampaignForm((current) => ({ ...current, totalClaimLimit: event.target.value }))} />
                                </div>
                            </div>

                            <div className={sectionClassName}>
                                <SectionLabel title="Takvim ve durum" description="Kampanyayı zaman penceresiyle veya manuel aktif/pasif olarak yönetebilirsin." />
                                <div className="grid gap-3 md:grid-cols-2">
                                    <input className={inputClassName} type="datetime-local" value={campaignForm.startsAt} onChange={(event) => setCampaignForm((current) => ({ ...current, startsAt: event.target.value }))} />
                                    <input className={inputClassName} type="datetime-local" value={campaignForm.endsAt} onChange={(event) => setCampaignForm((current) => ({ ...current, endsAt: event.target.value }))} />
                                </div>
                                <label className="flex items-center gap-3 rounded-2xl border border-border/70 bg-muted/20 px-3 py-3 text-sm text-foreground">
                                    <input type="checkbox" checked={campaignForm.isActive} onChange={(event) => setCampaignForm((current) => ({ ...current, isActive: event.target.checked }))} />
                                    Kampanya aktif kalsın
                                </label>
                            </div>

                            <div className="flex gap-2">
                                <Button onClick={() => void submitCampaign()} disabled={saving}>{editingCampaignId ? "Kampanyayı güncelle" : "Kampanya oluştur"}</Button>
                                {editingCampaignId !== null ? <Button variant="outline" onClick={() => { setEditingCampaignId(null); setCampaignForm(emptyCampaignForm); }}>İptal</Button> : null}
                            </div>
                        </div>
                    </div>

                    <div className="rounded-[30px] border border-border/80 bg-background/95 p-5 shadow-sm">
                        <div>
                            <h3 className="text-lg font-semibold text-foreground">Kod Üretim Merkezi</h3>
                                <p className="mt-1 text-sm text-muted-foreground">
                                    Tek kullanımlık içerik üretici kodu ya da toplu etkinlik batch&apos;i buradan üretilir.
                                </p>
                        </div>

                        <div className="mt-5 space-y-4">
                            <div className={sectionClassName}>
                                <SectionLabel title="Hedef kampanya" description="Kodlar claim olduğunda coin miktarını seçilen kampanya belirler." />
                                <select className={inputClassName} value={codeForm.campaignId} onChange={(event) => setCodeForm((current) => ({ ...current, campaignId: event.target.value }))}>
                                    <option value="">Kampanya seç</option>
                                    {eligibleCodeCampaigns.map((campaign) => (
                                        <option key={campaign.id} value={campaign.id}>{campaign.name} ({campaign.code})</option>
                                    ))}
                                </select>
                                {eligibleCodeCampaigns.length === 0 ? (
                                    <p className="text-xs text-muted-foreground">
                                        Kod üretmek için önce aktif ve arşivlenmemiş bir kampanya oluştur.
                                    </p>
                                ) : null}
                            </div>

                            <div className={sectionClassName}>
                                <SectionLabel title="Kod üretim modu" description="Tek bir manuel kod girebilir veya prefix ile toplu üretim yapabilirsin." />
                                <div className="grid gap-3 md:grid-cols-2">
                                    <input className={inputClassName} placeholder="Manuel kod (tekil kullanım)" value={codeForm.manualCode} onChange={(event) => setCodeForm((current) => ({ ...current, manualCode: event.target.value }))} />
                                    <input className={inputClassName} placeholder="Prefix (toplu üretim için)" value={codeForm.prefix} onChange={(event) => setCodeForm((current) => ({ ...current, prefix: event.target.value }))} />
                                </div>
                                <div className="grid gap-3 md:grid-cols-2">
                                    <input className={inputClassName} placeholder="Etiket / not" value={codeForm.label} onChange={(event) => setCodeForm((current) => ({ ...current, label: event.target.value }))} />
                                    <input className={inputClassName} type="number" min="1" max="100" placeholder="Toplu üretim adedi" value={codeForm.quantity} onChange={(event) => setCodeForm((current) => ({ ...current, quantity: event.target.value }))} />
                                </div>
                            </div>

                            <div className={sectionClassName}>
                                <SectionLabel title="Kod güvenlik limitleri" description="Kod bazlı claim limitini ve opsiyonel son kullanım tarihini ayarla." />
                                <div className="grid gap-3 md:grid-cols-2">
                                    <input className={inputClassName} type="number" min="1" placeholder="Kod claim limiti" value={codeForm.maxClaims} onChange={(event) => setCodeForm((current) => ({ ...current, maxClaims: event.target.value }))} />
                                    <input className={inputClassName} type="datetime-local" value={codeForm.expiresAt} onChange={(event) => setCodeForm((current) => ({ ...current, expiresAt: event.target.value }))} />
                                </div>
                                <label className="flex items-center gap-3 rounded-2xl border border-border/70 bg-muted/20 px-3 py-3 text-sm text-foreground">
                                    <input type="checkbox" checked={codeForm.isActive} onChange={(event) => setCodeForm((current) => ({ ...current, isActive: event.target.checked }))} />
                                    Kodlar aktif oluşturulsun
                                </label>
                            </div>

                            <Button
                                onClick={() => void submitCodes()}
                                disabled={saving || !codeForm.campaignId || eligibleCodeCampaigns.length === 0}
                            >
                                Kodları üret
                            </Button>
                        </div>
                    </div>

                </div>
            </div>
        </div>
    );
}

