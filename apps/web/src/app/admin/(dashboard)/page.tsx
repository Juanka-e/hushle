"use client";

import { useEffect, useState, useMemo } from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import {
    Activity,
    BookOpen,
    Eye,
    FolderTree,
    Gamepad2,
    Server,
    Users,
    Wifi,
} from "lucide-react";

interface DashboardStats {
    onlineKullaniciSayisi: number;
    aktifLobiSayisi: number;
    totalWords: number;
    totalCategories: number;
    wordsByDifficulty: { easy: number; medium: number; hard: number };
}

interface CapacityHealth {
    checkedAt: string;
    redis: {
        configured: boolean;
        available: boolean;
        latencyMs: number | null;
    };
    observability: {
        emitted: number;
        errors: number;
        warnings: number;
        exporterConfigured: boolean;
        exporterMode: "disabled" | "custom" | "http";
        exporterFailures: number;
        exporterQueued: number;
        exporterDelivered: number;
        exporterDropped: number;
        lastExportAt: string | null;
        droppedContextFields: number;
        lastErrorAt: string | null;
    };
    cluster: {
        source: "redis" | "local";
        activeInstances: number;
        activeRooms: number;
        activeMatches: number;
        onlinePlayers: number;
        spectators: number;
        connectedSockets: number;
        rssBytes: number;
        heapUsedBytes: number;
        maxEventLoopLagMs: number;
    };
    admission: {
        level: "normal" | "warning" | "critical" | "closed";
        allowCreate: boolean;
        allowJoin: boolean;
        roomUsagePercent: number;
        playerUsagePercent: number;
    };
    limits: {
        maxActiveRooms: number;
        maxOnlinePlayers: number;
        admissionMode: "automatic" | "open" | "closed";
    };
}

function formatBytes(value: number): string {
    if (!Number.isFinite(value) || value <= 0) return "0 MB";
    return `${Math.round(value / 1024 / 1024)} MB`;
}

export default function AdminDashboardPage() {
    const [stats, setStats] = useState<DashboardStats | null>(null);
    const [loading, setLoading] = useState(true);
    const [capacity, setCapacity] = useState<CapacityHealth | null>(null);
    const [capacityError, setCapacityError] = useState("");

    useEffect(() => {
        fetch("/api/admin/dashboard-stats")
            .then((res) => res.json())
            .then((data) => {
                setStats(data);
                setLoading(false);
            })
            .catch(() => setLoading(false));
    }, []);

    useEffect(() => {
        let active = true;
        const loadCapacity = async () => {
            try {
                const response = await fetch("/api/admin/capacity-health", {
                    cache: "no-store",
                });
                const data = (await response.json()) as
                    | CapacityHealth
                    | { error?: string };
                if (!response.ok || !("cluster" in data)) {
                    throw new Error(
                        "error" in data
                            ? data.error || "Kapasite durumu alınamadı."
                            : "Kapasite durumu alınamadı."
                    );
                }
                if (active) {
                    setCapacity(data);
                    setCapacityError("");
                }
            } catch (error) {
                if (active) {
                    setCapacityError(
                        error instanceof Error
                            ? error.message
                            : "Kapasite durumu alınamadı."
                    );
                }
            }
        };

        void loadCapacity();
        const interval = window.setInterval(loadCapacity, 10_000);
        return () => {
            active = false;
            window.clearInterval(interval);
        };
    }, []);

    // Memoize statCards to avoid recreating array on every render
    const statCards = useMemo(() => [
        {
            title: "Online Kullanıcılar",
            value: stats?.onlineKullaniciSayisi ?? 0,
            icon: Users,
            color: "text-emerald-500",
            bg: "bg-emerald-500/10",
        },
        {
            title: "Aktif Lobiler",
            value: stats?.aktifLobiSayisi ?? 0,
            icon: Gamepad2,
            color: "text-blue-500",
            bg: "bg-blue-500/10",
        },
        {
            title: "Toplam Kelime",
            value: stats?.totalWords ?? 0,
            icon: BookOpen,
            color: "text-purple-500",
            bg: "bg-purple-500/10",
        },
        {
            title: "Toplam Kategori",
            value: stats?.totalCategories ?? 0,
            icon: FolderTree,
            color: "text-amber-500",
            bg: "bg-amber-500/10",
        },
    ], [stats]);

    return (
        <div className="space-y-6">
            <div>
                <h1 className="text-2xl font-bold text-foreground">Dashboard</h1>
                <p className="text-sm text-muted-foreground mt-1">
                    Oyun istatistikleri ve genel bakış
                </p>
            </div>

            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
                {statCards.map(({ title, value, icon: Icon, color, bg }) => (
                    <Card key={title} className="border-border/50">
                        <CardContent className="flex items-center gap-4 p-5">
                            <div className={`p-3 rounded-xl ${bg}`}>
                                <Icon className={`h-5 w-5 ${color}`} />
                            </div>
                            <div>
                                <p className="text-xs text-muted-foreground font-medium">
                                    {title}
                                </p>
                                <p className="text-2xl font-bold text-foreground">
                                    {loading ? "—" : value.toLocaleString()}
                                </p>
                            </div>
                        </CardContent>
                    </Card>
                ))}
            </div>

            <Card className="overflow-hidden border-border/50">
                <CardHeader className="border-b border-border/50 bg-muted/20">
                    <div className="flex flex-wrap items-center justify-between gap-3">
                        <div>
                            <CardTitle className="flex items-center gap-2 text-lg">
                                <Activity className="h-5 w-5 text-cyan-500" />
                                Canlı Kapasite
                            </CardTitle>
                            <p className="mt-1 text-sm text-muted-foreground">
                                Redis heartbeat veya güvenli local fallback üzerinden canlı özet.
                            </p>
                        </div>
                        <span
                            className={`rounded-full px-3 py-1 text-xs font-bold uppercase tracking-[0.16em] ${
                                !capacity
                                    ? "bg-muted text-muted-foreground"
                                    : capacity.admission.level === "normal"
                                    ? "bg-emerald-500/10 text-emerald-600"
                                    : capacity.admission.level === "warning"
                                      ? "bg-amber-500/10 text-amber-600"
                                      : "bg-red-500/10 text-red-600"
                            }`}
                        >
                            {capacity?.admission.level ?? "bekleniyor"}
                        </span>
                    </div>
                </CardHeader>
                <CardContent className="space-y-5 p-5">
                    {capacityError ? (
                        <div className="rounded-xl border border-red-500/20 bg-red-500/5 px-4 py-3 text-sm text-red-600">
                            {capacityError}
                        </div>
                    ) : null}

                    <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
                        {[
                            {
                                label: "Aktif maç",
                                value: capacity?.cluster.activeMatches ?? 0,
                                icon: Gamepad2,
                            },
                            {
                                label: "İzleyici",
                                value: capacity?.cluster.spectators ?? 0,
                                icon: Eye,
                            },
                            {
                                label: "Socket",
                                value: capacity?.cluster.connectedSockets ?? 0,
                                icon: Wifi,
                            },
                            {
                                label: "Instance",
                                value: capacity?.cluster.activeInstances ?? 0,
                                icon: Server,
                            },
                        ].map(({ label, value, icon: Icon }) => (
                            <div
                                key={label}
                                className="flex items-center gap-3 rounded-xl border border-border/60 bg-muted/15 px-4 py-3"
                            >
                                <Icon className="h-4 w-4 text-cyan-500" />
                                <div>
                                    <p className="text-xs text-muted-foreground">{label}</p>
                                    <p className="text-lg font-bold text-foreground">{value}</p>
                                </div>
                            </div>
                        ))}
                    </div>

                    <div className="grid gap-4 lg:grid-cols-2">
                        <div className="space-y-2 rounded-xl border border-border/60 p-4">
                            <div className="flex items-center justify-between text-sm">
                                <span className="font-semibold">Oda kullanımı</span>
                                <span className="text-muted-foreground">
                                    {capacity?.cluster.activeRooms ?? 0} / {capacity?.limits.maxActiveRooms ?? 0}
                                </span>
                            </div>
                            <div className="h-2 overflow-hidden rounded-full bg-muted">
                                <div
                                    className="h-full rounded-full bg-blue-500 transition-all"
                                    style={{ width: `${capacity?.admission.roomUsagePercent ?? 0}%` }}
                                />
                            </div>
                        </div>
                        <div className="space-y-2 rounded-xl border border-border/60 p-4">
                            <div className="flex items-center justify-between text-sm">
                                <span className="font-semibold">Oyuncu kullanımı</span>
                                <span className="text-muted-foreground">
                                    {capacity?.cluster.onlinePlayers ?? 0} / {capacity?.limits.maxOnlinePlayers ?? 0}
                                </span>
                            </div>
                            <div className="h-2 overflow-hidden rounded-full bg-muted">
                                <div
                                    className="h-full rounded-full bg-emerald-500 transition-all"
                                    style={{ width: `${capacity?.admission.playerUsagePercent ?? 0}%` }}
                                />
                            </div>
                        </div>
                    </div>

                    <div className="flex flex-wrap gap-x-5 gap-y-2 text-xs text-muted-foreground">
                        <span>
                            Redis: {capacity?.redis.available ? `${capacity.redis.latencyMs ?? 0} ms` : "erişilemiyor"}
                        </span>
                        <span>Kaynak: {capacity?.cluster.source ?? "-"}</span>
                        <span>RSS: {formatBytes(capacity?.cluster.rssBytes ?? 0)}</span>
                        <span>Heap: {formatBytes(capacity?.cluster.heapUsedBytes ?? 0)}</span>
                        <span>Event loop: {capacity?.cluster.maxEventLoopLagMs ?? 0} ms</span>
                        <span>Mod: {capacity?.limits.admissionMode ?? "-"}</span>
                    </div>

                    <div className="grid gap-3 border-t border-border/50 pt-4 sm:grid-cols-2 xl:grid-cols-4">
                        <div className="rounded-xl bg-muted/20 px-4 py-3">
                            <p className="text-xs text-muted-foreground">Runtime hatalari</p>
                            <p className="mt-1 text-lg font-bold text-foreground">
                                {capacity?.observability.errors ?? 0}
                            </p>
                        </div>
                        <div className="rounded-xl bg-muted/20 px-4 py-3">
                            <p className="text-xs text-muted-foreground">Uyarilar</p>
                            <p className="mt-1 text-lg font-bold text-foreground">
                                {capacity?.observability.warnings ?? 0}
                            </p>
                        </div>
                        <div className="rounded-xl bg-muted/20 px-4 py-3">
                            <p className="text-xs text-muted-foreground">Merkezi exporter</p>
                            <p className="mt-1 text-sm font-bold text-foreground">
                                {capacity?.observability.exporterConfigured
                                    ? `${capacity.observability.exporterMode} bagli`
                                    : "Henuz bagli degil"}
                            </p>
                        </div>
                        <div className="rounded-xl bg-muted/20 px-4 py-3">
                            <p className="text-xs text-muted-foreground">Exporter hatasi</p>
                            <p className="mt-1 text-lg font-bold text-foreground">
                                {capacity?.observability.exporterFailures ?? 0}
                            </p>
                        </div>
                    </div>
                    <div className="flex flex-wrap gap-x-5 gap-y-2 text-xs text-muted-foreground">
                        <span>Kuyruk: {capacity?.observability.exporterQueued ?? 0}</span>
                        <span>Teslim: {capacity?.observability.exporterDelivered ?? 0}</span>
                        <span>Dusurulen: {capacity?.observability.exporterDropped ?? 0}</span>
                    </div>
                </CardContent>
            </Card>

            {/* Difficulty breakdown */}
            {stats?.wordsByDifficulty && (
                <Card className="border-border/50">
                    <CardHeader>
                        <CardTitle className="text-lg">Zorluk Dağılımı</CardTitle>
                    </CardHeader>
                    <CardContent>
                        <div className="flex gap-6">
                            <div className="flex items-center gap-2">
                                <div className="w-3 h-3 rounded-full bg-emerald-500" />
                                <span className="text-sm text-muted-foreground">Kolay:</span>
                                <span className="text-sm font-bold">
                                    {stats.wordsByDifficulty.easy}
                                </span>
                            </div>
                            <div className="flex items-center gap-2">
                                <div className="w-3 h-3 rounded-full bg-amber-500" />
                                <span className="text-sm text-muted-foreground">Orta:</span>
                                <span className="text-sm font-bold">
                                    {stats.wordsByDifficulty.medium}
                                </span>
                            </div>
                            <div className="flex items-center gap-2">
                                <div className="w-3 h-3 rounded-full bg-red-500" />
                                <span className="text-sm text-muted-foreground">Zor:</span>
                                <span className="text-sm font-bold">
                                    {stats.wordsByDifficulty.hard}
                                </span>
                            </div>
                        </div>
                    </CardContent>
                </Card>
            )}
        </div>
    );
}
