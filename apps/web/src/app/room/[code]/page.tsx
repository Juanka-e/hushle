"use client";

import Image from "next/image";
import { useState, useEffect, useCallback, useRef, useTransition } from "react";
import { useParams, useRouter } from "next/navigation";
import { io, Socket } from "socket.io-client";
import { useSession } from "next-auth/react";
import { Sidebar } from "@/components/game/sidebar";
import { RulesModal } from "@/components/game/rules-modal";
import { Lobby } from "@/components/game/lobby";
import { AnnouncementsModal } from "@/components/game/announcements-modal";
import { DashboardOverlay } from "@/components/game/dashboard-overlay";
import { Moon, Sun, Megaphone, Book, Menu, LayoutDashboard, Lock, Pencil, Save, UserRound, ArrowRight, LoaderCircle } from "lucide-react";
import { useTheme } from "next-themes";
import { useBranding } from "@/components/providers/branding-provider";
import { LanguageSwitcher } from "@/components/i18n/language-switcher";
import { useI18n } from "@/components/providers/i18n-provider";
import { clearActiveRoomPresenceTab, writeActiveRoomPresence } from "@/lib/client/active-room-presence";
import type { ResolvedCardFaceTheme } from "@/lib/cosmetics/card-face";
import type { ResolvedCardBackTheme } from "@/lib/cosmetics/card-back";
import { ROOM_ROLE_GUESSER } from "@/lib/game/room-display";
import { getCaptchaTokenForAction } from "@/lib/security/captcha-client";
import {
    SOCKET_CLIENT_AUTH,
    getSocketProtocolErrorMessage,
} from "@/lib/socket/protocol-version";
import { GameView } from "@/types/game";
import type {
    Player,
    GameState,
    CardData,
    RoomData,
    TransitionData,
    TurnInfo,
    GameOverData,
    CategoryItem,
    PendingAdminHandoffState,
} from "@/types/game";
import {
    DEFAULT_GAME_CONTENT_LOCALE,
    type GameContentLocale,
} from "@hushle/domain-game";

// Sub-components
import { TransitionScreen } from "./_components/transition-screen";
import { ActiveGame } from "./_components/active-game";
import { GameOverScreen } from "./_components/game-over-screen";
import { UsernamePrompt } from "./_components/username-prompt";

interface SocketIdentityPayload {
    playerId: string;
    guestToken: string | null;
}

interface ActiveRoomGuardState {
    status: "checking" | "ready" | "blocked";
    roomCode: string | null;
    pendingAdminHandoff: PendingAdminHandoffState | null;
    requiresHostReturn: boolean;
}

const ROOM_SWITCH_TEAM_EVENT = "takim_degistir";
const ROOM_START_GAME_EVENT = "oyun_baslat";
const ROOM_GAME_CONTROL_EVENT = "oyun_kontrol";
const ROOM_RESET_GAME_EVENT = "oyun_sifirla";

function flattenCategoryIds(items: CategoryItem[]): number[] {
    const ids: number[] = [];

    for (const item of items) {
        ids.push(item.id);
        const children = item.children ?? [];
        for (const child of children) {
            ids.push(child.id);
        }
    }

    return ids;
}

export default function RoomPage() {
    const params = useParams();
    const router = useRouter();
    const { theme, setTheme } = useTheme();
    const [, startTransition] = useTransition();
    const roomCode = params.code as string;
    const { data: session } = useSession();
    const branding = useBranding();
    const { t } = useI18n();
    const activeRoomPresenceKey = session?.user?.id ? `tabu_active_room_presence:${session.user.id}` : null;
    const roomPresenceTabIdRef = useRef("");

    // Socket
    const socketRef = useRef<Socket | null>(null);
    const [isConnected, setIsConnected] = useState(false);
    const [myPlayerId, setMyPlayerId] = useState("");
    const rewardClaimedMatchesRef = useRef<Set<string>>(new Set());
    const currentMatchSequenceRef = useRef(0);
    const isInitialTransitionRef = useRef(false);

    // Room state
    const [view, setView] = useState<GameView>(GameView.LOBBY);
    const [players, setPlayers] = useState<Player[]>([]);
    const [creatorPlayerId, setCreatorPlayerId] = useState("");
    const [startReadiness, setStartReadiness] = useState({
        ready: false,
        activePlayers: 0,
        minimumPlayers: 4,
        teamAPlayers: 0,
        teamBPlayers: 0,
    });
    const [pendingAdminHandoff, setPendingAdminHandoff] = useState<PendingAdminHandoffState | null>(null);

    // Settings
    const [settings, setSettings] = useState({
        sure: 60,
        mod: "tur" as "tur" | "skor",
        deger: 2,
        wordLocale: DEFAULT_GAME_CONTENT_LOCALE as GameContentLocale,
    });
    const [selectedCategories, setSelectedCategories] = useState<number[]>([]);
    const [selectedDifficulties, setSelectedDifficulties] = useState<number[]>([]);
    const [categories, setCategories] = useState<CategoryItem[]>([]);

    // Game state
    const [gameState, setGameState] = useState<GameState | null>(null);
    const [card, setCard] = useState<CardData | null>(null);
    const [myRole, setMyRole] = useState(ROOM_ROLE_GUESSER);
    const [isPrimaryInspector, setIsPrimaryInspector] = useState(false);
    const [narratorName, setNarratorName] = useState("");
    const [inspectorName, setInspectorName] = useState("");
    const [cardFaceTheme, setCardFaceTheme] = useState<ResolvedCardFaceTheme | null>(null);
    const [cardBackTheme, setCardBackTheme] = useState<ResolvedCardBackTheme | null>(null);

    // Transition
    const [transition, setTransition] = useState<TransitionData | null>(null);

    // Game over
    const [gameOverData, setGameOverData] = useState<GameOverData | null>(null);

    // Sidebar
    const [sidebarAOpen, setSidebarAOpen] = useState(true);
    const [sidebarBOpen, setSidebarBOpen] = useState(true);
    const [isMobile, setIsMobile] = useState(false);

    // Modals
    const [showRules, setShowRules] = useState(false);
    const [showAnnouncements, setShowAnnouncements] = useState(false);
    const [showDashboard, setShowDashboard] = useState(false);
    const [hasConfirmedUsername, setHasConfirmedUsername] = useState(false);
    const [entryError, setEntryError] = useState("");
    const [showIdentityEditor, setShowIdentityEditor] = useState(false);
    const [showUtilityMenu, setShowUtilityMenu] = useState(false);
    const [identityDraftName, setIdentityDraftName] = useState("");
    const [identitySaving, setIdentitySaving] = useState(false);
    const [identityError, setIdentityError] = useState("");
    const [storedUsername, setStoredUsername] = useState<string | null>(null);
    const [activeRoomGuard, setActiveRoomGuard] = useState<ActiveRoomGuardState>({
        status: "checking",
        roomCode: null,
        pendingAdminHandoff: null,
        requiresHostReturn: false,
    });
    const isRoomClientReady = storedUsername !== null;
    const isAuthenticatedRoomUser = Boolean(session?.user?.id);
    const normalizedRoomCode = roomCode.trim().toUpperCase();
    const showUsernamePrompt =
        isRoomClientReady &&
        !isAuthenticatedRoomUser &&
        !hasConfirmedUsername &&
        (storedUsername || "").trim().length === 0;
    const currentPlayer = players.find((player) => player.playerId === myPlayerId) ?? null;
    const currentVisibleName =
        currentPlayer?.ad ||
        (storedUsername || "").trim() ||
        session?.user?.name ||
        "Oyuncu";
    const currentAvatarUrl = currentPlayer?.cosmetics?.avatarImageUrl ?? null;
    const currentFrameUrl = currentPlayer?.cosmetics?.frameImageUrl ?? null;
    const currentFrameAccentColor = currentPlayer?.cosmetics?.frameAccentColor ?? null;
    const canEditIdentity = view === GameView.LOBBY;
    const shouldShowIdentityLabel = !isMobile && view === GameView.LOBBY;
    const allCategoryIds = flattenCategoryIds(categories);
    const brandLabel = branding.siteName.trim() || "Hushle";
    const brandShortLabel = branding.siteShortName.trim() || "H";
    const isActiveRoomGuardReady = !isAuthenticatedRoomUser || activeRoomGuard.status === "ready";

    useEffect(() => {
        if (!isAuthenticatedRoomUser) {
            setActiveRoomGuard({
                status: "ready",
                roomCode: null,
                pendingAdminHandoff: null,
                requiresHostReturn: false,
            });
            return;
        }

        let cancelled = false;
        setActiveRoomGuard((current) => ({
            ...current,
            status: "checking",
        }));

        async function loadActiveRoomGuard() {
            try {
                const response = await fetch("/api/user/active-room", {
                    method: "GET",
                    cache: "no-store",
                    credentials: "same-origin",
                });

                if (!response.ok) {
                    if (!cancelled) {
                        setActiveRoomGuard({
                            status: "ready",
                            roomCode: null,
                            pendingAdminHandoff: null,
                            requiresHostReturn: false,
                        });
                    }
                    return;
                }

                const payload = (await response.json()) as {
                    roomCode?: string | null;
                    pendingAdminHandoff?: PendingAdminHandoffState | null;
                    requiresHostReturn?: boolean;
                };
                const serverRoomCode =
                    typeof payload.roomCode === "string" && payload.roomCode.length > 0
                        ? payload.roomCode.toUpperCase()
                        : null;

                if (cancelled) {
                    return;
                }

                if (serverRoomCode && serverRoomCode !== normalizedRoomCode) {
                    setActiveRoomGuard({
                        status: "blocked",
                        roomCode: serverRoomCode,
                        pendingAdminHandoff: payload.pendingAdminHandoff ?? null,
                        requiresHostReturn: payload.requiresHostReturn === true,
                    });
                    return;
                }

                setActiveRoomGuard({
                    status: "ready",
                    roomCode: serverRoomCode,
                    pendingAdminHandoff: payload.pendingAdminHandoff ?? null,
                    requiresHostReturn: payload.requiresHostReturn === true,
                });
            } catch {
                if (!cancelled) {
                    setActiveRoomGuard({
                        status: "ready",
                        roomCode: null,
                        pendingAdminHandoff: null,
                        requiresHostReturn: false,
                    });
                }
            }
        }

        void loadActiveRoomGuard();

        return () => {
            cancelled = true;
        };
    }, [isAuthenticatedRoomUser, normalizedRoomCode]);

    useEffect(() => {
        const syncStoredUsername = () => {
            setStoredUsername(window.localStorage.getItem("tabu_username") || "");
        };
        const syncDisplayNameEvent = (event: Event) => {
            const nextDisplayName =
                event instanceof CustomEvent &&
                typeof event.detail?.displayName === "string"
                    ? event.detail.displayName
                    : window.localStorage.getItem("tabu_username") || "";
            setStoredUsername(nextDisplayName);
        };

        syncStoredUsername();
        window.addEventListener("storage", syncStoredUsername);
        window.addEventListener("tabu:display-name-updated", syncDisplayNameEvent);
        return () => {
            window.removeEventListener("storage", syncStoredUsername);
            window.removeEventListener("tabu:display-name-updated", syncDisplayNameEvent);
        };
    }, []);

    useEffect(() => {
        if (!activeRoomPresenceKey) {
            return;
        }

        const tabId =
            roomPresenceTabIdRef.current ||
            window.sessionStorage.getItem("tabu_room_presence_tab_id") ||
            window.crypto.randomUUID();

        roomPresenceTabIdRef.current = tabId;
        window.sessionStorage.setItem("tabu_room_presence_tab_id", tabId);

        const writePresence = () => {
            writeActiveRoomPresence(
                activeRoomPresenceKey,
                window.localStorage,
                roomCode,
                tabId
            );
        };

        const clearPresence = () => {
            clearActiveRoomPresenceTab(activeRoomPresenceKey, window.localStorage, tabId);
        };

        writePresence();
        const intervalId = window.setInterval(writePresence, 5_000);
        window.addEventListener("pagehide", clearPresence);
        window.addEventListener("beforeunload", clearPresence);

        return () => {
            window.clearInterval(intervalId);
            window.removeEventListener("pagehide", clearPresence);
            window.removeEventListener("beforeunload", clearPresence);
            clearPresence();
        };
    }, [activeRoomPresenceKey, roomCode]);

    useEffect(() => {
        setIdentityDraftName(currentVisibleName);
    }, [currentVisibleName]);

    useEffect(() => {
        if (currentVisibleName.trim().length > 0) {
            window.localStorage.setItem("tabu_username", currentVisibleName);
        }
    }, [currentVisibleName]);

    useEffect(() => {
        if (view !== GameView.LOBBY) {
            setShowIdentityEditor(false);
            setIdentityError("");
        }
    }, [view]);

    useEffect(() => {
        if (!isMobile) {
            setShowUtilityMenu(false);
        }
    }, [isMobile]);

    // Responsive check
    useEffect(() => {
        const handleResize = () => {
            const mobile = window.innerWidth < 1024;
            startTransition(() => {
                setIsMobile(mobile);
                if (mobile) {
                    setSidebarAOpen(false);
                    setSidebarBOpen(false);
                } else {
                    setSidebarAOpen(true);
                    setSidebarBOpen(true);
                }
            });
        };
        handleResize();
        window.addEventListener("resize", handleResize, { passive: true });
        return () => window.removeEventListener("resize", handleResize);
    }, []);

    // Connect socket (only when username is set)
    useEffect(() => {
        if (!isRoomClientReady || showUsernamePrompt || !isActiveRoomGuardReady) return;

        let isMounted = true;
        let activeSocket: Socket | null = null;
        const username = storedUsername || session?.user?.name || "Oyuncu";

        async function connectToRoom(): Promise<void> {
            try {
                setEntryError("");
                const guestToken = session?.user?.id
                    ? undefined
                    : window.sessionStorage.getItem("tabu_guestToken") || undefined;
                const captchaToken = session?.user?.id
                    ? null
                    : (await getCaptchaTokenForAction("guest_join")).token;

                if (!isMounted) {
                    return;
                }

                const socket = io({
                    path: "/api/socketio",
                    auth: SOCKET_CLIENT_AUTH,
                    transports: ["websocket", "polling"],
                    tryAllTransports: true,
                });

                activeSocket = socket;
                socketRef.current = socket;

                socket.on("connect", () => {
                    setIsConnected(true);
                    socket.emit("room:request", {
                        kullaniciAdi: username,
                        odaKodu: roomCode,
                        ...(guestToken ? { guestToken } : {}),
                        ...(captchaToken ? { captchaToken } : {}),
                    });
                });

                socket.on("disconnect", () => setIsConnected(false));

                socket.on("connect_error", (error) => {
                    setIsConnected(false);
                    setEntryError(
                        getSocketProtocolErrorMessage(error) ??
                            "Sunucuya bağlanılamadı. Lütfen tekrar deneyin."
                    );
                });

                socket.on("kimlikAta", ({ playerId, guestToken: assignedGuestToken }: SocketIdentityPayload) => {
                    window.sessionStorage.setItem("tabu_playerId", playerId);
                    if (assignedGuestToken) {
                        window.sessionStorage.setItem("tabu_guestToken", assignedGuestToken);
                    } else {
                        window.sessionStorage.removeItem("tabu_guestToken");
                    }
                    setMyPlayerId(playerId);
                });

                socket.on("lobiGuncelle", (data: RoomData & { creatorPlayerId?: string }) => {
                    setPlayers(data.oyuncular);
                    setCreatorPlayerId(data.creatorPlayerId || "");
                    setSettings(data.ayarlar);
                    if (data.startReadiness) {
                        setStartReadiness(data.startReadiness);
                    }
                    if (data.seciliKategoriler) setSelectedCategories(data.seciliKategoriler);
                    if (data.seciliZorluklar) setSelectedDifficulties(data.seciliZorluklar);
                });

                socket.on("yoneticiDevriDurumu", (data: PendingAdminHandoffState | null) => {
                    setPendingAdminHandoff(data);
                });

                socket.on("kategoriListesiGonder", (cats: CategoryItem[]) => {
                    setCategories(cats);
                });

                socket.on("kategoriAyarlariGuncellendi", (data: {
                    seciliKategoriler: number[];
                    seciliZorluklar: number[];
                    wordLocale?: GameContentLocale;
                }) => {
                    setSelectedCategories(data.seciliKategoriler);
                    setSelectedDifficulties(data.seciliZorluklar);
                    if (data.wordLocale) {
                        setSettings((current) => ({
                            ...current,
                            wordLocale: data.wordLocale ?? current.wordLocale,
                        }));
                    }
                });

                socket.on("oyunBasladi", () => {
                    currentMatchSequenceRef.current += 1;
                    isInitialTransitionRef.current = true;
                    setView(GameView.TRANSITION);
                    setIsPrimaryInspector(false);
                    setCardFaceTheme(null);
                });

                socket.on("turGecisiBaslat", (data: TransitionData) => {
                    setView(GameView.TRANSITION);
                    setIsPrimaryInspector(false);
                    setTransition(data);
                    setCardBackTheme(data.cardBackTheme);
                });

                socket.on("turGecisDurumGuncelle", (data: { oyunDurduruldu: boolean; kalanSure: number }) => {
                    setTransition((prev) =>
                        prev
                            ? {
                                  ...prev,
                                  kalanSure: data.kalanSure,
                                  oyunDurduruldu: data.oyunDurduruldu,
                              }
                            : null
                    );
                });

                socket.on("yeniTurBilgisi", (data: TurnInfo) => {
                    isInitialTransitionRef.current = false;
                    setMyRole(data.rol);
                    setIsPrimaryInspector(data.isPrimaryGozetmen);
                    setCard(data.kart);
                    setNarratorName(data.anlaticiAd);
                    setInspectorName(data.gozetmenAd);
                    setCardFaceTheme(data.cardFaceTheme);
                    setCardBackTheme(data.cardBackTheme);
                    setView(GameView.PLAYING);
                });

                socket.on("oyunDurumuGuncelle", (data: GameState) => {
                    setGameState(data);
                });

                socket.on("kartGuncelle", (newCard: CardData | null) => {
                    setCard(newCard);
                });

                socket.on("oyunBitti", (data: GameOverData) => {
                    setView(GameView.GAME_OVER);
                    setGameOverData(data);

                    if (!session?.user?.id) return;
                    const claimKey = `${roomCode}:${currentMatchSequenceRef.current}`;
                    if (rewardClaimedMatchesRef.current.has(claimKey)) return;

                    rewardClaimedMatchesRef.current.add(claimKey);
                    const tryFinalizeReward = async (attempt = 0) => {
                        try {
                            const response = await fetch("/api/game/match/finalize", {
                                method: "POST",
                                headers: { "Content-Type": "application/json" },
                                body: JSON.stringify({
                                    roomCode,
                                }),
                            });

                            if (response.ok) {
                                return;
                            }

                            const payload = (await response.json().catch(() => null)) as { error?: string } | null;
                            const shouldRetry =
                                attempt < 2 &&
                                (response.status === 404 ||
                                    (response.status === 409 &&
                                        payload?.error === "Mac henuz tamamlanmadi."));

                            if (shouldRetry) {
                                window.setTimeout(() => {
                                    void tryFinalizeReward(attempt + 1);
                                }, 750);
                                return;
                            }

                            rewardClaimedMatchesRef.current.delete(claimKey);
                        } catch {
                            rewardClaimedMatchesRef.current.delete(claimKey);
                        }
                    };

                    void tryFinalizeReward();
                });

                socket.on("altinSkorBasladi", () => {
                    // Game state update handles the golden score UI
                });

                socket.on("lobiyeDon", () => {
                    isInitialTransitionRef.current = false;
                    setView(GameView.LOBBY);
                    setGameState(null);
                    setCard(null);
                    setIsPrimaryInspector(false);
                    setGameOverData(null);
                    setTransition(null);
                    setCardFaceTheme(null);
                    setCardBackTheme(null);
                    setPendingAdminHandoff(null);
                });

                socket.on("odadanAtildin", () => {
                    router.push("/");
                });

                socket.on("hata", (msg: string) => {
                    console.error("Socket error:", msg);
                    setEntryError(msg);
                    const normalizedMessage = msg.toLocaleLowerCase("tr-TR");
                    if (normalizedMessage.includes("bulunamad") || normalizedMessage.includes("found")) {
                        router.push("/");
                    }
                });
            } catch {
                if (isMounted) {
                    setEntryError("Guvenlik dogrulamasi baslatilamadi. Lutfen tekrar deneyin.");
                }
            }
        }

        void connectToRoom();

        return () => {
            isMounted = false;
            activeSocket?.disconnect();
        };
    }, [isActiveRoomGuardReady, isRoomClientReady, roomCode, router, session?.user?.id, session?.user?.name, showUsernamePrompt, storedUsername]);

    // Actions

    const emit = useCallback(
        (event: string, data?: unknown) => {
            socketRef.current?.emit(event, data);
        },
        []
    );

    const isHost = myPlayerId && creatorPlayerId ? myPlayerId === creatorPlayerId : false;

    const handleIdentitySave = useCallback(async () => {
        const nextDisplayName = identityDraftName.trim();

        if (!isAuthenticatedRoomUser && !nextDisplayName) {
            setIdentityError("Gecerli bir gorunen ad gir.");
            return;
        }

        if (!canEditIdentity) {
            setIdentityError("Mac basladiktan sonra gorunen ad degistirilemez.");
            return;
        }

        if (nextDisplayName === currentVisibleName) {
            setShowIdentityEditor(false);
            setIdentityError("");
            return;
        }

        setIdentitySaving(true);
        setIdentityError("");

        try {
            if (isAuthenticatedRoomUser) {
                const response = await fetch("/api/user/profile", {
                    method: "PATCH",
                    headers: { "Content-Type": "application/json" },
                    body: JSON.stringify({
                        displayName: nextDisplayName,
                    }),
                });

                if (!response.ok) {
                    const payload = (await response.json().catch(() => null)) as {
                        error?: string;
                    } | null;
                    setIdentityError(payload?.error || "Gorunen ad guncellenemedi.");
                    return;
                }

                const payload = (await response.json()) as {
                    profile?: {
                        displayName?: string | null;
                    };
                };
                const persistedDisplayName =
                    payload.profile?.displayName?.trim() ||
                    session?.user?.name ||
                    currentVisibleName;

                window.localStorage.setItem("tabu_username", persistedDisplayName);
                window.dispatchEvent(
                    new CustomEvent("tabu:display-name-updated", {
                        detail: { displayName: persistedDisplayName },
                    })
                );
                setPlayers((currentPlayers) =>
                    currentPlayers.map((player) =>
                        player.playerId === myPlayerId
                            ? { ...player, ad: persistedDisplayName }
                            : player
                    )
                );
                setIdentityDraftName(persistedDisplayName);
                setShowIdentityEditor(false);
                setIdentitySaving(false);

                socketRef.current?.emit(
                    "gorunen_ad_guncelle",
                    { displayName: persistedDisplayName },
                    (response: { ok: boolean; error?: string; displayName?: string }) => {
                        if (!response.ok) {
                            setEntryError(response.error || "Lobi gorunen adi guncellenemedi.");
                            return;
                        }

                        const syncedDisplayName = response.displayName || persistedDisplayName;
                        window.localStorage.setItem("tabu_username", syncedDisplayName);
                        window.dispatchEvent(
                            new CustomEvent("tabu:display-name-updated", {
                                detail: { displayName: syncedDisplayName },
                            })
                        );
                        setPlayers((currentPlayers) =>
                            currentPlayers.map((player) =>
                                player.playerId === myPlayerId
                                    ? { ...player, ad: syncedDisplayName }
                                    : player
                            )
                        );
                    }
                );
                return;
            }

            const socket = socketRef.current;
            if (!socket) {
                setIdentityError("Baglanti bulunamadi.");
                return;
            }

            const result = await new Promise<{
                ok: boolean;
                error?: string;
                displayName?: string;
            }>((resolve) => {
                socket.emit(
                    "gorunen_ad_guncelle",
                    { displayName: nextDisplayName },
                    (response: {
                        ok: boolean;
                        error?: string;
                        displayName?: string;
                    }) => resolve(response)
                );
            });

            if (!result.ok) {
                setIdentityError(result.error || "Gorunen ad guncellenemedi.");
                return;
            }

            const confirmedDisplayName = result.displayName || nextDisplayName;
            window.localStorage.setItem("tabu_username", confirmedDisplayName);
            window.dispatchEvent(
                new CustomEvent("tabu:display-name-updated", {
                    detail: { displayName: confirmedDisplayName },
                })
            );
            setPlayers((currentPlayers) =>
                currentPlayers.map((player) =>
                    player.playerId === myPlayerId
                        ? { ...player, ad: confirmedDisplayName }
                        : player
                )
            );
            setIdentityDraftName(confirmedDisplayName);
            setShowIdentityEditor(false);
        } catch {
            setIdentityError("Gorunen ad guncellenemedi.");
        } finally {
            setIdentitySaving(false);
        }
    }, [
        canEditIdentity,
        currentVisibleName,
        identityDraftName,
        isAuthenticatedRoomUser,
        myPlayerId,
        session?.user?.name,
    ]);

    const handleStartGame = useCallback(() => {
        emit(ROOM_START_GAME_EVENT, {
            seciliKategoriler: selectedCategories,
            seciliZorluklar: selectedDifficulties,
            ayarlar: settings,
        });
    }, [emit, selectedCategories, selectedDifficulties, settings]);

    const handleWordAction = useCallback(
        (action: "dogru" | "tabu" | "pas") => {
            emit("oyunVerisi", { eylem: action });
        },
        [emit]
    );

    const handleTransitionControl = useCallback(() => {
        emit(ROOM_GAME_CONTROL_EVENT);
    }, [emit]);

    // Render

    const renderGameContent = () => {
        if (view === GameView.TRANSITION && transition) {
            return (
                <TransitionScreen
                    transition={transition}
                    isHost={Boolean(isHost)}
                    onPauseResume={handleTransitionControl}
                />
            );
        }

        if (view === GameView.PLAYING) {
            return (
                <ActiveGame
                    gameState={gameState}
                    card={card}
                    myRole={myRole}
                    isPrimaryInspector={isPrimaryInspector}
                    narratorName={narratorName}
                    inspectorName={inspectorName}
                    isHost={isHost as boolean}
                    settings={settings}
                    cardFaceTheme={cardFaceTheme}
                    cardBackTheme={cardBackTheme}
                    onWordAction={handleWordAction}
                    onPauseResume={() => emit(ROOM_GAME_CONTROL_EVENT)}
                    onResetGame={() => emit(ROOM_RESET_GAME_EVENT)}
                />
            );
        }

        if (view === GameView.GAME_OVER && gameOverData) {
            return (
                <GameOverScreen
                    gameOverData={gameOverData}
                    onReturnToLobby={() => emit(ROOM_RESET_GAME_EVENT)}
                />
            );
        }

        // Lobby (default)
        return (
            <Lobby
                roomCode={roomCode}
                settings={settings}
                selectedCategories={selectedCategories}
                selectedDifficulties={selectedDifficulties}
                categories={categories}
                isHost={isHost as boolean}
                startReadiness={startReadiness}
                pendingAdminHandoff={pendingAdminHandoff}
                onUpdateSettings={(nextSettings) => {
                    const localeChanged = nextSettings.wordLocale !== settings.wordLocale;
                    setSettings(nextSettings);
                    if (localeChanged) {
                        setSelectedCategories([]);
                        emit("kategoriAyarlariGuncelle", {
                            seciliKategoriler: [],
                            seciliZorluklar: selectedDifficulties.length > 0
                                ? selectedDifficulties
                                : [1, 2, 3],
                            wordLocale: nextSettings.wordLocale,
                        });
                    }
                }}
                onInitialSet={(cats, diffs) => {
                    setSelectedCategories(cats);
                    setSelectedDifficulties(diffs);
                    emit("kategoriAyarlariGuncelle", {
                        seciliKategoriler: cats,
                        seciliZorluklar: diffs,
                        wordLocale: settings.wordLocale,
                    });
                }}
                onUpdateCategories={(cats) => {
                    setSelectedCategories(cats);
                    emit("kategoriAyarlariGuncelle", {
                        seciliKategoriler: cats,
                        seciliZorluklar: selectedDifficulties.length > 0 ? selectedDifficulties : [1, 2, 3],
                        wordLocale: settings.wordLocale,
                    });
                }}
                onUpdateDifficulties={(diffs) => {
                    setSelectedDifficulties(diffs);
                    emit("kategoriAyarlariGuncelle", {
                        seciliKategoriler: selectedCategories.length > 0 ? selectedCategories : allCategoryIds,
                        seciliZorluklar: diffs,
                        wordLocale: settings.wordLocale,
                    });
                }}
                onShuffleTeams={() => emit("takimlariKaristir")}
                onSwitchTeam={() => emit(ROOM_SWITCH_TEAM_EVENT)}
                onStartGame={handleStartGame}
                onKickPlayer={(playerId) =>
                    emit("oyuncuyuAt", { targetPlayerId: playerId })
                }
                onTransferHost={(playerId) =>
                    emit("yoneticiligiDevret", { targetPlayerId: playerId })
                }
            />
        );
    };

    if (!isRoomClientReady) {
        return (
            <main className="flex min-h-screen items-center justify-center bg-gray-50 px-6 dark:bg-slate-900">
                <div className="rounded-3xl border border-gray-200 bg-white px-8 py-6 text-center shadow-xl dark:border-slate-800 dark:bg-slate-900">
                    <div className="text-xs font-bold uppercase tracking-[0.2em] text-gray-400 dark:text-gray-500">
                        Lobby Yukleniyor
                    </div>
                    <div className="mt-2 text-sm font-medium text-gray-600 dark:text-gray-300">
                        Oda bilgileri hazirlaniyor.
                    </div>
                </div>
            </main>
        );
    }

    if (isAuthenticatedRoomUser && activeRoomGuard.status === "checking") {
        return (
            <main className="flex min-h-screen items-center justify-center bg-gray-50 px-6 dark:bg-slate-900">
                <div className="rounded-3xl border border-gray-200 bg-white px-8 py-6 text-center shadow-xl dark:border-slate-800 dark:bg-slate-900">
                    <div className="mx-auto flex h-14 w-14 items-center justify-center rounded-2xl bg-indigo-100 text-indigo-700 dark:bg-indigo-900/30 dark:text-indigo-200">
                        <LoaderCircle className="h-6 w-6 animate-spin" />
                    </div>
                    <div className="mt-4 text-xs font-bold uppercase tracking-[0.2em] text-gray-400 dark:text-gray-500">
                        {t("room.activeRoomCheck")}
                    </div>
                    <div className="mt-2 text-sm font-medium text-gray-600 dark:text-gray-300">
                        Hangi odaya devam etmen gerektigini dogruluyoruz.
                    </div>
                </div>
            </main>
        );
    }

    if (isAuthenticatedRoomUser && activeRoomGuard.status === "blocked" && activeRoomGuard.roomCode) {
        return (
            <main className="flex min-h-screen items-center justify-center bg-gray-50 px-6 dark:bg-slate-900">
                <div className="w-full max-w-lg rounded-3xl border border-amber-200 bg-white p-6 shadow-xl dark:border-amber-900/40 dark:bg-slate-900">
                    <div className="flex items-start gap-4">
                        <div className="rounded-2xl bg-amber-100 p-3 text-amber-700 dark:bg-amber-900/40 dark:text-amber-200">
                            <ArrowRight className="h-6 w-6" />
                        </div>
                        <div className="min-w-0 flex-1">
                            <div className="text-xs font-black uppercase tracking-[0.18em] text-amber-700/80 dark:text-amber-300/80">
                                {t("room.activeRoomFound")}
                            </div>
                            <div className="mt-2 text-xl font-black text-slate-900 dark:text-white">
                                {t("room.mustReturnRoom", { code: activeRoomGuard.roomCode })}
                            </div>
                            <div className="mt-3 text-sm text-slate-600 dark:text-slate-300">
                                {t("room.roomConflictDetail", { requested: normalizedRoomCode, active: activeRoomGuard.roomCode })}
                            </div>
                            <div className="mt-2 text-sm text-slate-500 dark:text-slate-400">
                                {activeRoomGuard.requiresHostReturn
                                    ? t("room.roomConflictHostHelp")
                                    : t("room.roomConflictHelp")}
                            </div>
                            <div className="mt-5 flex flex-col gap-3 sm:flex-row">
                                <button
                                    type="button"
                                    onClick={() => router.replace(`/room/${activeRoomGuard.roomCode}`)}
                                    className="inline-flex items-center justify-center gap-2 rounded-2xl bg-amber-500 px-4 py-3 text-sm font-black text-slate-950 transition hover:bg-amber-400"
                                >
                                    <ArrowRight className="h-4 w-4" />
                                    {t("room.returnActiveRoom")}
                                </button>
                                <button
                                    type="button"
                                    onClick={() => router.replace("/dashboard")}
                                    className="rounded-2xl border border-gray-200 px-4 py-3 text-sm font-bold text-slate-700 transition hover:bg-gray-50 dark:border-slate-700 dark:text-slate-200 dark:hover:bg-slate-800"
                                >
                                    {t("room.goDashboard")}
                                </button>
                            </div>
                        </div>
                    </div>
                </div>
            </main>
        );
    }

    return (
        <>
            {/* Username Prompt */}
            {showUsernamePrompt && (
                    <UsernamePrompt
                        onConfirm={(username) => {
                            localStorage.setItem("tabu_username", username);
                            setStoredUsername(username);
                            setHasConfirmedUsername(true);
                        }}
                    />
            )}

            <div className="flex h-screen w-screen overflow-hidden bg-gray-50 dark:bg-slate-900 transition-colors duration-300">
                {/* Mobile Menu Toggles */}
                {isMobile && (
                    <>
                        <button
                            type="button"
                            aria-label={t("room.openTeamPanel", { team: "A" })}
                            data-testid="mobile-team-a-toggle"
                            onClick={() => setSidebarAOpen((prev) => !prev)}
                            className={`fixed left-0 top-1/2 z-[90] -translate-y-1/2 rounded-r-xl bg-red-600 p-2.5 text-white shadow-lg transition-transform ${
                                sidebarAOpen ? "-translate-x-full" : "translate-x-0"
                            }`}
                        >
                            <Menu size={20} />
                        </button>
                        <button
                            type="button"
                            aria-label={t("room.openTeamPanel", { team: "B" })}
                            data-testid="mobile-team-b-toggle"
                            onClick={() => setSidebarBOpen((prev) => !prev)}
                            className={`fixed right-0 top-1/2 z-[90] -translate-y-1/2 rounded-l-xl bg-blue-600 p-2.5 text-white shadow-lg transition-transform ${
                                sidebarBOpen ? "translate-x-full" : "translate-x-0"
                            }`}
                        >
                            <Menu size={20} />
                        </button>
                    </>
                )}

                {/* Team A Sidebar (Red) */}
                <Sidebar
                    team="A"
                    players={players}
                    creatorPlayerId={creatorPlayerId}
                    currentPlayerId={myPlayerId}
                    isOpen={sidebarAOpen}
                    onToggle={() => setSidebarAOpen((prev) => !prev)}
                    isMobile={isMobile}
                    onSwitchTeam={
                        view === GameView.LOBBY
                            ? () => emit(ROOM_SWITCH_TEAM_EVENT)
                            : undefined
                    }
                    onMoveNarrator={isHost && view === GameView.LOBBY ? (playerId, direction) => emit("narrator_order", { playerId, direction }) : undefined}
                    onKickPlayer={isHost ? (playerId) => emit("oyuncuyuAt", { targetPlayerId: playerId }) : undefined}
                    onTransferHost={isHost ? (playerId) => emit("yoneticiligiDevret", { targetPlayerId: playerId }) : undefined}
                />

                {/* Main Content Area */}
                <main className="flex-1 flex flex-col relative overflow-hidden min-w-0">
                    <div className="relative z-[80] flex items-start justify-between gap-2 px-3 pt-3 sm:gap-3 sm:px-4 sm:pt-4">
                        <div className="flex min-w-0 flex-1 items-start gap-2 sm:gap-3">
                            <div
                                className="absolute left-1/2 top-3 flex -translate-x-1/2 items-center justify-center rounded-2xl border border-white/70 bg-white/85 px-3 py-2 shadow-lg backdrop-blur dark:border-slate-700 dark:bg-slate-900/85 sm:top-4"
                                aria-label={brandLabel}
                            >
                                {branding.logoUrl ? (
                                    <Image
                                        src={branding.logoUrl}
                                        alt={`${branding.siteName} logo`}
                                        width={88}
                                        height={36}
                                        unoptimized
                                        className="h-7 w-auto max-w-24 object-contain sm:h-8 sm:max-w-28"
                                    />
                                ) : (
                                    <span className="bg-gradient-to-r from-red-500 to-blue-500 bg-clip-text text-sm font-black uppercase tracking-[0.2em] text-transparent">
                                        {brandShortLabel}
                                    </span>
                                )}
                            </div>
                        </div>
                        <div className="flex items-start gap-2">
                        <div className="relative">
                            {!isMobile ? (
                                <button
                                    type="button"
                                    onClick={() => {
                                        if (!canEditIdentity) return;
                                        setIdentityDraftName(currentVisibleName);
                                        setIdentityError("");
                                        setShowIdentityEditor((current) => !current);
                                    }}
                                    className={`flex items-center gap-2 rounded-full border bg-white/95 px-2 py-1.5 shadow-lg backdrop-blur dark:bg-slate-800/95 ${
                                        canEditIdentity
                                            ? "border-gray-100 text-gray-700 hover:text-indigo-600 dark:border-slate-700 dark:text-gray-200 dark:hover:text-indigo-300"
                                            : "border-amber-200/70 text-gray-700 dark:border-amber-700/40 dark:text-gray-200"
                                    }`}
                                >
                                    <div
                                        className="relative flex h-8 w-8 items-center justify-center overflow-hidden rounded-full"
                                        style={currentFrameAccentColor ? { boxShadow: `0 0 0 2px ${currentFrameAccentColor}55` } : undefined}
                                    >
                                        {currentFrameUrl ? (
                                            <Image
                                                src={currentFrameUrl}
                                                alt=""
                                                fill
                                                unoptimized
                                                className="pointer-events-none absolute inset-0 object-cover opacity-95"
                                            />
                                        ) : null}
                                        {currentAvatarUrl ? (
                                            <Image
                                                src={currentAvatarUrl}
                                                alt=""
                                                width={30}
                                                height={30}
                                                unoptimized
                                                className="relative z-10 h-7 w-7 rounded-full object-cover"
                                            />
                                        ) : (
                                            <div className="relative z-10 flex h-7 w-7 items-center justify-center rounded-full bg-indigo-100 text-indigo-700 dark:bg-indigo-900/40 dark:text-indigo-200">
                                                <UserRound size={14} />
                                            </div>
                                        )}
                                    </div>
                                    {shouldShowIdentityLabel ? (
                                        <div className="max-w-[6.5rem] truncate text-sm font-bold">
                                            {currentVisibleName}
                                        </div>
                                    ) : null}
                                    {canEditIdentity ? <Pencil size={14} /> : <Lock size={14} />}
                                </button>
                            ) : (
                                <div className="flex items-center gap-1.5">
                                    {session?.user ? (
                                        <button
                                            onClick={() => setShowDashboard(true)}
                                            className="rounded-xl border border-gray-100 bg-white p-2 text-gray-600 shadow-lg transition-all hover:text-indigo-600 dark:border-slate-700 dark:bg-slate-800 dark:text-gray-300 dark:hover:text-indigo-400 sm:p-2.5"
                                        >
                                            <LayoutDashboard size={18} />
                                        </button>
                                    ) : null}
                                    <button
                                        type="button"
                                        onClick={() => setShowUtilityMenu((current) => !current)}
                                        className="rounded-xl border border-gray-100 bg-white p-2 text-gray-600 shadow-lg transition-all hover:text-slate-900 dark:border-slate-700 dark:bg-slate-800 dark:text-gray-300 dark:hover:text-white sm:p-2.5"
                                    >
                                        <Menu size={18} />
                                    </button>
                                </div>
                            )}

                            {showUtilityMenu && isMobile ? (
                                <div className="absolute right-0 mt-2 w-[min(15rem,calc(100vw-1.5rem))] rounded-2xl border border-gray-200 bg-white p-2 shadow-2xl dark:border-slate-700 dark:bg-slate-900">
                                    <button
                                        type="button"
                                        onClick={() => {
                                            setShowUtilityMenu(false);
                                            if (!canEditIdentity) return;
                                            setIdentityDraftName(currentVisibleName);
                                            setIdentityError("");
                                            setShowIdentityEditor(true);
                                        }}
                                        className="flex w-full items-center gap-3 rounded-xl px-3 py-2 text-left text-sm font-semibold text-gray-700 transition hover:bg-gray-50 dark:text-gray-200 dark:hover:bg-slate-800"
                                    >
                                        <Pencil size={16} />
                                        {t("room.displayName")}
                                    </button>
                                    <button
                                        type="button"
                                        onClick={() => {
                                            setShowUtilityMenu(false);
                                            setShowAnnouncements(true);
                                        }}
                                        className="flex w-full items-center gap-3 rounded-xl px-3 py-2 text-left text-sm font-semibold text-gray-700 transition hover:bg-gray-50 dark:text-gray-200 dark:hover:bg-slate-800"
                                    >
                                        <Megaphone size={16} />
                                        {t("home.announcements")}
                                    </button>
                                    <button
                                        type="button"
                                        onClick={() => {
                                            setShowUtilityMenu(false);
                                            setShowRules(true);
                                        }}
                                        className="flex w-full items-center gap-3 rounded-xl px-3 py-2 text-left text-sm font-semibold text-gray-700 transition hover:bg-gray-50 dark:text-gray-200 dark:hover:bg-slate-800"
                                    >
                                        <Book size={16} />
                                        {t("room.rules")}
                                    </button>
                                    <button
                                        type="button"
                                        onClick={() => {
                                            setShowUtilityMenu(false);
                                            setTheme(theme === "dark" ? "light" : "dark");
                                        }}
                                        className="flex w-full items-center gap-3 rounded-xl px-3 py-2 text-left text-sm font-semibold text-gray-700 transition hover:bg-gray-50 dark:text-gray-200 dark:hover:bg-slate-800"
                                    >
                                        {theme === "dark" ? <Sun size={16} /> : <Moon size={16} />}
                                        {t("room.theme")}
                                    </button>
                                    <div className="px-3 py-2">
                                        <LanguageSwitcher />
                                    </div>
                                </div>
                            ) : null}

                            {showIdentityEditor && canEditIdentity ? (
                                <div className="absolute right-0 mt-2 w-[min(18rem,calc(100vw-1.5rem))] rounded-2xl border border-gray-200 bg-white p-3 shadow-2xl dark:border-slate-700 dark:bg-slate-900">
                                    <div className="space-y-3">
                                        <div className="space-y-1">
                                            <div className="text-xs font-bold uppercase tracking-[0.18em] text-gray-400">
                                                {t("room.editDisplayName")}
                                            </div>
                                            <div className="text-xs text-gray-500 dark:text-gray-400">
                                                {isAuthenticatedRoomUser
                                                    ? t("room.registeredNameHelp")
                                                    : t("room.guestNameHelp")}
                                            </div>
                                        </div>
                                        <input
                                            type="text"
                                            value={identityDraftName}
                                            onChange={(event) => setIdentityDraftName(event.target.value)}
                                            maxLength={60}
                                            className="w-full rounded-xl border border-gray-200 bg-gray-50 px-3 py-2.5 text-sm font-medium text-gray-800 outline-none focus:border-transparent focus:ring-2 focus:ring-indigo-500 dark:border-slate-700 dark:bg-slate-800 dark:text-gray-100"
                                        />
                                        <div className="text-[11px] text-gray-400 dark:text-gray-500">
                                            {t("room.nameLockHelp")}
                                        </div>
                                        {identityError ? (
                                            <div className="rounded-xl border border-red-200 bg-red-50 px-3 py-2 text-xs font-medium text-red-700 dark:border-red-900/40 dark:bg-red-950/30 dark:text-red-300">
                                                {identityError}
                                            </div>
                                        ) : null}
                                        <div className="flex gap-2">
                                            <button
                                                type="button"
                                                onClick={() => {
                                                    setShowIdentityEditor(false);
                                                    setIdentityDraftName(currentVisibleName);
                                                    setIdentityError("");
                                                }}
                                                className="flex-1 rounded-xl border border-gray-200 px-3 py-2 text-sm font-semibold text-gray-600 transition hover:bg-gray-50 dark:border-slate-700 dark:text-gray-300 dark:hover:bg-slate-800"
                                            >
                                                Vazgeç
                                            </button>
                                            <button
                                                type="button"
                                                onClick={() => void handleIdentitySave()}
                                                disabled={identitySaving}
                                                className="inline-flex flex-1 items-center justify-center gap-2 rounded-xl bg-indigo-600 px-3 py-2 text-sm font-bold text-white transition hover:bg-indigo-700 disabled:cursor-not-allowed disabled:opacity-50"
                                            >
                                                <Save size={14} />
                                                {identitySaving ? "Kaydediliyor" : "Kaydet"}
                                            </button>
                                        </div>
                                    </div>
                                </div>
                            ) : null}
                        </div>
                        {!isMobile && session?.user && (
                            <button
                                onClick={() => setShowDashboard(true)}
                                className="p-2.5 rounded-xl bg-white dark:bg-slate-800 shadow-lg border border-gray-100 dark:border-slate-700 text-gray-600 dark:text-gray-300 hover:text-indigo-600 dark:hover:text-indigo-400 hover:scale-105 transition-all"
                            >
                                <LayoutDashboard size={20} />
                            </button>
                        )}
                        {!isMobile ? <button
                            onClick={() => setShowAnnouncements(true)}
                            className="p-2.5 rounded-xl bg-white dark:bg-slate-800 shadow-lg border border-gray-100 dark:border-slate-700 text-gray-600 dark:text-gray-300 hover:text-blue-600 dark:hover:text-blue-400 hover:scale-105 transition-all"
                        >
                            <Megaphone size={20} />
                        </button> : null}
                        {!isMobile ? <button
                            onClick={() => setShowRules(true)}
                            className="p-2.5 rounded-xl bg-white dark:bg-slate-800 shadow-lg border border-gray-100 dark:border-slate-700 text-gray-600 dark:text-gray-300 hover:text-purple-600 dark:hover:text-purple-400 hover:scale-105 transition-all"
                        >
                            <Book size={20} />
                        </button> : null}
                        {!isMobile ? <button
                            onClick={() =>
                                setTheme(theme === "dark" ? "light" : "dark")
                            }
                            className="p-2.5 rounded-xl bg-white dark:bg-slate-800 shadow-lg border border-gray-100 dark:border-slate-700 text-gray-600 dark:text-gray-300 hover:text-amber-500 dark:hover:text-amber-400 hover:scale-105 transition-all"
                        >
                            <span className="relative flex h-5 w-5 items-center justify-center">
                                <Sun className="h-5 w-5 rotate-0 scale-100 transition-all dark:-rotate-90 dark:scale-0" />
                                <Moon className="absolute h-5 w-5 rotate-90 scale-0 transition-all dark:rotate-0 dark:scale-100" />
                            </span>
                        </button> : null}
                        {!isMobile ? <LanguageSwitcher compact /> : null}
                    </div>
                    </div>

                    {/* Connection indicator */}
                    {!isConnected || entryError ? (
                        <div className="relative z-[75] flex flex-col gap-2 px-3 pt-3 sm:px-4">
                            {!isConnected ? (
                                <div className="inline-flex w-fit items-center gap-2 rounded-full border border-red-200 bg-red-100 px-3 py-1.5 text-xs font-medium text-red-600 dark:border-red-800/30 dark:bg-red-900/20 dark:text-red-400">
                                    <div className="w-2 h-2 rounded-full bg-red-500 animate-pulse" />
                                    Bağlantı kesildi
                                </div>
                            ) : null}

                            {entryError ? (
                                <div className="max-w-sm rounded-xl border border-destructive/20 bg-destructive/10 px-3 py-2 text-xs font-medium text-destructive shadow-lg">
                                    {entryError}
                                </div>
                            ) : null}
                        </div>
                    ) : null}

                    {/* Game Area */}
                    {view === GameView.LOBBY ? (
                        <div className="h-full overflow-y-auto flex items-center justify-center">
                            {renderGameContent()}
                        </div>
                    ) : (
                        renderGameContent()
                    )}
                </main>

                {/* Team B Sidebar (Blue) */}
                <Sidebar
                    team="B"
                    players={players}
                    creatorPlayerId={creatorPlayerId}
                    currentPlayerId={myPlayerId}
                    isOpen={sidebarBOpen}
                    onToggle={() => setSidebarBOpen((prev) => !prev)}
                    isMobile={isMobile}
                    onSwitchTeam={
                        view === GameView.LOBBY
                            ? () => emit(ROOM_SWITCH_TEAM_EVENT)
                            : undefined
                    }
                    onMoveNarrator={isHost && view === GameView.LOBBY ? (playerId, direction) => emit("narrator_order", { playerId, direction }) : undefined}
                    onKickPlayer={isHost ? (playerId) => emit("oyuncuyuAt", { targetPlayerId: playerId }) : undefined}
                    onTransferHost={isHost ? (playerId) => emit("yoneticiligiDevret", { targetPlayerId: playerId }) : undefined}
                />

                {/* Rules Modal */}
                <RulesModal
                    isOpen={showRules}
                    onClose={() => setShowRules(false)}
                />

                {/* Announcements Modal */}
                <AnnouncementsModal
                    isOpen={showAnnouncements}
                    onClose={() => setShowAnnouncements(false)}
                />

                {/* Dashboard Overlay */}
                {session?.user && (
                    <DashboardOverlay
                        isOpen={showDashboard}
                        onClose={() => setShowDashboard(false)}
                    />
                )}
            </div>
        </>
    );
}



















