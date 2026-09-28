import { Server, Socket } from "socket.io";
import { randomInt } from "node:crypto";
import { z } from "zod";
import { isEmailVerificationRestrictionActive } from "@hushle/platform-auth";
import { getToken } from "next-auth/jwt";
import {
    TABU_DEFAULT_SETTINGS,
    TABU_MODE_ID,
    GAME_CONTENT_LOCALES,
    createInitialTabuState,
    normalizeTabuRoomSettings,
    resolveTabuFinish,
    shouldFinishTabuAfterAction,
    shouldFinishTabuBeforeRound,
    type GameModeId,
    type TabuRoomSettings,
    type WordAction,
} from "@hushle/domain-game";
import { getPlayerAppearanceSnapshot, getPlayerCardCosmeticsSnapshot } from "@/lib/economy";
import { createEmptyRoomCardThemes, resolveRoomCardThemes, type RoomCardThemePayload } from "@/lib/cosmetics/room-card-themes";
import { prisma } from "@/lib/prisma";
import { getSocketClientIp } from "@/lib/security/client-ip";
import { resolveSocketPlayerIdentity } from "@/lib/security/player-identity";
import { verifyCaptchaForAction } from "@/lib/security/captcha";
import { consumeDistributedRequestRateLimit } from "@/lib/security/request-rate-limit";
import {
    allowOriginlessSocketClients,
    isTrustedWebOrigin,
    parseTrustedWebOrigins,
} from "@/lib/security/web-origin-policy";
import { evaluateRoomRequestPolicy } from "@/lib/system-settings/policies";
import { getSystemSettings } from "@/lib/system-settings/service";
import { clearExpiredSuspensions, isSuspensionActive } from "@/lib/moderation/service";
import {
    SOCKET_PROTOCOL_ERROR_CODE,
    evaluateSocketProtocolVersion,
    readSocketProtocolVersionFromAuth,
} from "@/lib/socket/protocol-version";
import { getNextWord, clearWordPool } from "./word-service";
import { getVisibleCategories } from "./category-service";
import {
    claimOnlineRoomMembership,
    getOnlineRoomMembership,
    refreshOnlineRoomMembership,
    releaseOnlineRoomMembership,
} from "./room-membership";
import {
    clearPendingRoomAdminHandoff,
    getPendingRoomAdminHandoff,
    setPendingRoomAdminHandoff,
} from "./room-admin-handoff";
import { runWithRoomActionLock } from "./room-action-lock";
import type { PlayerCosmetics } from "@/types/game";
import type { CapacitySettings } from "@/types/system-settings";
import { registerMetricsProvider } from "./room-metrics";
import {
    canMoveToTeam,
    chooseJoinTeam,
    evaluateCapacityAdmission,
    getEffectiveRoomMaxPlayers,
    resolveRoomStartDecision,
} from "./room-capacity-policy";
import {
    getCapacityClusterSnapshot,
    publishCapacityHeartbeat,
} from "./room-capacity";
import type { RoomOwnershipCoordinator } from "./room-ownership";
import {
    ROOM_ROUTING_JOIN_ERROR,
    shouldRejectRoomRoute,
    type RoomRouteResolver,
} from "./room-routing";
import {
    recordWordAnalytics,
    type WordAnalyticsOutcome,
} from "@/lib/analytics/word-analytics";
import {
    joinUserSessionRoom,
    registerSocketServer,
} from "./user-session-control";

// ─── Types ─────────────────────────────────────────────────────

interface BanList {
    playerIds: Set<string>;
    ips: Set<string>;
}

interface PlayerData {
    id: string;
    playerId: string;
    userId: number | null;
    identityType: "registered" | "guest";
    usernameSnapshot: string | null;
    ad: string;
    takim: "A" | "B" | null;
    online: boolean;
    rol: "Oyuncu" | "İzleyici" | "Anlatıcı" | "Gözetmen" | "Tahminci";
    ip: string;
    cosmetics: PlayerCosmetics;
}

interface NarratorInfo {
    id: string;
    playerId: string;
    ad: string;
    takim: "A" | "B";
}

interface GameStateData {
    startingTeam?: "A" | "B";
    oyunAktifMi: boolean;
    oyunDurduruldu: boolean;
    gecisEkraninda: boolean;
    mevcutTur: number;
    toplamTur: number;
    kalanZaman: number;
    kalanPasHakki: number;
    skor: { A: number; B: number };
    anlatacakTakim: "A" | "B";
    takimA_anlaticiIndex: number;
    takimB_anlaticiIndex: number;
    anlatici: NarratorInfo | null;
    gozetmen: NarratorInfo | null;
    aktifKart: unknown;
    altinSkorAktif: boolean;
    kalanGecisSuresi?: number;
    basladiAt?: number | null;
    bittiAt?: number | null;
}

interface ActiveTransitionSnapshot {
    anlatici: { ad: string; takim: "A" | "B" };
    gozetmen: { ad: string; takim: "A" | "B" } | null;
    ilkGecis: boolean;
    cardBackTheme: RoomCardThemePayload["cardBackTheme"];
}

interface MatchParticipantSnapshot {
    playerId: string;
    userId: number | null;
    identityType: "registered" | "guest";
    usernameSnapshot: string | null;
    displayNameSnapshot: string;
    teamAtStart: "A" | "B";
    roleAtStart: "Oyuncu" | "Anlatıcı" | "Gözetmen" | "Tahminci";
}

interface RoomData {
    odaKodu: string;
    gameMode: GameModeId;
    creatorId: string;
    creatorPlayerId: string; // Persistent ID for admin
    oyuncular: PlayerData[];
    ayarlar: TabuRoomSettings;
    gecerliKategoriIdleri: number[];
    gecerliZorlukSeviyeleri: number[];
    seciliKategoriler?: number[];
    seciliZorluklar?: number[];
    oyunDurumu: GameStateData;
    activeTransition: ActiveTransitionSnapshot | null;
    matchParticipants: MatchParticipantSnapshot[];
    activeWordAnalytics: {
        wordId: number;
        categoryIds: number[];
        difficulty: 1 | 2 | 3;
        remainingSecondsAtDisplay: number;
    } | null;
    zamanlayici: ReturnType<typeof setInterval> | null;
    banList: BanList;
}

export interface RoomMatchSnapshot {
    odaKodu: string;
    gameMode: GameModeId;
    oyunAktifMi: boolean;
    skor: { A: number; B: number };
    matchStartedAt: string | null;
    matchEndedAt: string | null;
    sureSeconds: number | null;
    matchFormat: TabuRoomSettings["mod"];
    matchTarget: number;
    oyuncular: Array<{
        playerId: string;
        userId: number | null;
        identityType: "registered" | "guest";
        usernameSnapshot: string | null;
        ad: string;
        takim: "A" | "B" | null;
        roleAtStart: string;
    }>;
}

// ─── State ─────────────────────────────────────────────────────

const globalForGameSocket = globalThis as typeof globalThis & {
    __tabuGameSocketState?: {
        rooms: Map<string, RoomData>;
        wordActionTimestamps: Map<string, number>;
        socketActionWindows: Map<
            string,
            { windowStartedAt: number; requestCount: number }
        >;
        socketToRoom: Map<string, string>;
        registeredUserRoomIndex: Map<number, string>;
        roomRegisteredUsersIndex: Map<string, Set<number>>;
        roomAdminTimeouts: Map<string, NodeJS.Timeout>;
        socketMembershipHeartbeats: Map<string, NodeJS.Timeout>;
    };
};

const sharedGameSocketState =
    globalForGameSocket.__tabuGameSocketState ??
    (globalForGameSocket.__tabuGameSocketState = {
        rooms: new Map<string, RoomData>(),
        wordActionTimestamps: new Map<string, number>(),
        socketActionWindows: new Map(),
        socketToRoom: new Map<string, string>(),
        registeredUserRoomIndex: new Map<number, string>(),
        roomRegisteredUsersIndex: new Map<string, Set<number>>(),
        roomAdminTimeouts: new Map<string, NodeJS.Timeout>(),
        socketMembershipHeartbeats: new Map<string, NodeJS.Timeout>(),
    });

const rooms = sharedGameSocketState.rooms;
const wordActionTimestamps = sharedGameSocketState.wordActionTimestamps;
const socketActionWindows =
    sharedGameSocketState.socketActionWindows ??
    (sharedGameSocketState.socketActionWindows = new Map());
const WORD_ACTION_COOLDOWN_MS = 200;
const SOCKET_ACTION_WINDOW_MS = 10_000;
const SOCKET_ACTION_MAX_REQUESTS = 10;

// Reverse index: socketId → roomCode (O(1) room lookup)
const socketToRoom = sharedGameSocketState.socketToRoom;
const registeredUserRoomIndex = sharedGameSocketState.registeredUserRoomIndex;
const roomRegisteredUsersIndex = sharedGameSocketState.roomRegisteredUsersIndex;
const socketMembershipHeartbeats = sharedGameSocketState.socketMembershipHeartbeats;
let connectedSocketCountGetter: () => number = () => 0;

// Rate limit settings from .env (can be disabled for localhost/testing)
const RATE_LIMIT_ENABLED = process.env.RATE_LIMIT_ENABLED !== "false";
const ROOM_JOIN_WINDOW_MS = parseInt(process.env.ROOM_JOIN_WINDOW_SECONDS || "60", 10) * 1000;
const ROOM_JOIN_MAX_ATTEMPTS = parseInt(process.env.ROOM_JOIN_MAX_ATTEMPTS || "100", 10);

// Admin Transfer Timeout
const roomAdminTimeouts = sharedGameSocketState.roomAdminTimeouts;
const ADMIN_TIMEOUT_MS = parseInt(process.env.ADMIN_TIMEOUT_MS || "180000", 10); // Default 3 mins
// Preserve malformed wire aliases from clients released before the ASCII migration.
const ROOM_START_GAME_EVENTS = ["oyun_baslat", "oyunBaslatİsteği", "oyunBaslat\u00c4\u00b0ste\u00c4\u0178i"] as const;
const ROOM_GAME_CONTROL_EVENTS = ["oyun_kontrol", "oyunKontrolİsteği", "oyunKontrol\u00c4\u00b0ste\u00c4\u0178i"] as const;
const ROOM_RESET_GAME_EVENTS = ["oyun_sifirla", "oyunuSifirlaİsteği", "oyunuSifirla\u00c4\u00b0ste\u00c4\u0178i"] as const;
const ROOM_SWITCH_TEAM_EVENTS = ["takim_degistir", "takimDegistirİsteği", "takimDegistir\u00c4\u00b0ste\u00c4\u0178i"] as const;
const ROOM_UPDATE_DISPLAY_NAME_EVENT = "gorunen_ad_guncelle";

// ─── Helpers ───────────────────────────────────────────────────

function getClientIp(socket: Socket): string {
    return getSocketClientIp(socket);
}

function consumeSocketActionBurstLimit(
    socketId: string,
    action: string
): boolean {
    const now = Date.now();
    const key = `${socketId}:${action}`;
    const current = socketActionWindows.get(key);

    if (!current || now - current.windowStartedAt >= SOCKET_ACTION_WINDOW_MS) {
        socketActionWindows.set(key, {
            windowStartedAt: now,
            requestCount: 1,
        });
        return true;
    }

    if (current.requestCount >= SOCKET_ACTION_MAX_REQUESTS) {
        return false;
    }

    current.requestCount += 1;
    return true;
}

function clearSocketActionBurstLimits(socketId: string): void {
    const prefix = `${socketId}:`;
    for (const key of socketActionWindows.keys()) {
        if (key.startsWith(prefix)) {
            socketActionWindows.delete(key);
        }
    }
}

function clearSocketMembershipHeartbeat(socketId: string): void {
    const heartbeat = socketMembershipHeartbeats.get(socketId);
    if (!heartbeat) {
        return;
    }

    clearInterval(heartbeat);
    socketMembershipHeartbeats.delete(socketId);
}

function startSocketMembershipHeartbeat(
    socketId: string,
    userId: number,
    roomCode: string
): void {
    clearSocketMembershipHeartbeat(socketId);

    const heartbeat = setInterval(() => {
        void refreshOnlineRoomMembership(userId, roomCode);
    }, 10_000);

    if (typeof heartbeat.unref === "function") {
        heartbeat.unref();
    }

    socketMembershipHeartbeats.set(socketId, heartbeat);
}

function createInitialGameState(): GameStateData {
    return {
        ...createInitialTabuState(),
        anlatici: null,
        gozetmen: null,
        aktifKart: null,
    };
}

function sanitizePlayerName(name: unknown): string {
    return String(name || "")
        .trim()
        .slice(0, 50)
        .replace(/[<>]/g, "");
}

function shuffleArray<T>(array: T[]): T[] {
    for (let i = array.length - 1; i > 0; i -= 1) {
        const j = Math.floor(Math.random() * (i + 1));
        [array[i], array[j]] = [array[j], array[i]];
    }
    return array;
}

// ─── Zod Schemas ───────────────────────────────────────────────

const OdaIstegiSchema = z.object({
    kullaniciAdi: z.string().min(1).max(50),
    odaKodu: z.string().max(10).optional(),
    guestToken: z.string().min(20).max(512).optional(),
    captchaToken: z.string().min(1).max(2048).optional(),
});

const KategoriAyarlariSchema = z.object({
    seciliKategoriler: z.array(z.number().int().positive()).max(100),
    seciliZorluklar: z.array(z.number().int().min(1).max(3)).max(3),
    wordLocale: z.enum(GAME_CONTENT_LOCALES).optional(),
});

const DisplayNameUpdateSchema = z.object({
    displayName: z.string().trim().min(1).max(60),
});

const PlayerTargetSchema = z.object({
    targetPlayerId: z.string().trim().min(1).max(128),
});

const StartGameSchema = z.object({
    seciliKategoriler: z.array(z.number().int().positive()).max(100),
    seciliZorluklar: z.array(z.number().int().min(1).max(3)).max(3),
    ayarlar: z.object({
        sure: z.union([z.string(), z.number()]),
        mod: z.enum(["tur", "skor"]),
        deger: z.union([z.string(), z.number()]),
        wordLocale: z.enum(GAME_CONTENT_LOCALES).optional(),
    }),
});

const OyunVerisiSchema = z.object({
    eylem: z.enum(["dogru", "tabu", "pas"]),
});

interface VisibleCategoryNode {
    id: number;
    children: VisibleCategoryNode[];
}

function collectVisibleCategoryIds(
    categories: VisibleCategoryNode[]
): Set<number> {
    const ids = new Set<number>();
    const visit = (nodes: VisibleCategoryNode[]) => {
        for (const node of nodes) {
            ids.add(node.id);
            visit(node.children);
        }
    };
    visit(categories);
    return ids;
}

// ─── Setup ─────────────────────────────────────────────────────

export function setupGameSocket(
    io: Server,
    roomOwnership: RoomOwnershipCoordinator,
    roomRouting: RoomRouteResolver
): void {
    registerSocketServer(io);
    connectedSocketCountGetter = () => io.engine.clientsCount;
    registerMetricsProvider(getRoomMetrics);

    io.use((socket, next) => {
        const decision = evaluateSocketProtocolVersion(
            readSocketProtocolVersionFromAuth(socket.handshake.auth)
        );
        if (!decision.accepted) {
            const error = new Error(
                "Yeni bir oyun surumu hazir. Devam etmek icin sayfayi yenileyin."
            ) as Error & { data?: Record<string, unknown> };
            error.data = {
                code: SOCKET_PROTOCOL_ERROR_CODE,
                clientVersion: decision.clientVersion,
                serverVersion: decision.serverVersion,
                minimumVersion: decision.minimumVersion,
                reason: decision.reason,
            };
            next(error);
            return;
        }

        socket.data.clientProtocolVersion = decision.effectiveClientVersion;
        next();
    });

    function publishCurrentCapacity(): void {
        void publishCapacityHeartbeat(getLocalRoomCapacityMetrics()).catch(
            (error) => {
                console.error("Capacity heartbeat could not be published", error);
            }
        );
    }

    function generateRoomCodeCandidate(): string {
        return Math.random().toString(36).substring(2, 8).toUpperCase();
    }

    async function claimAvailableRoomCode(): Promise<string> {
        for (let attempt = 0; attempt < 10; attempt += 1) {
            const roomCode = generateRoomCodeCandidate();
            if (rooms.has(roomCode)) continue;

            let claim;
            try {
                claim = await roomOwnership.claim(roomCode);
            } catch (error) {
                console.error("Room ownership claim failed", error);
                throw new Error(
                    "Oda şu anda oluşturulamıyor. Lütfen kısa süre sonra tekrar deneyin."
                );
            }
            if (claim.acquired) {
                return roomCode;
            }
        }

        throw new Error(
            "Oda kodu şu anda oluşturulamadı. Lütfen kısa süre sonra tekrar deneyin."
        );
    }

    function getRoom(roomCode: string): RoomData | undefined {
        return rooms.get(roomCode);
    }

    function getRoomBySocketId(socketId: string): RoomData | undefined {
        const code = socketToRoom.get(socketId);
        return code ? rooms.get(code) : undefined;
    }

    function persistRoom(room: RoomData): void {
        rooms.set(room.odaKodu, room);
        syncRegisteredUserRoomIndex(room);
    }

    function destroyRoom(roomCode: string): void {
        const indexedUsers = roomRegisteredUsersIndex.get(roomCode);
        if (indexedUsers) {
            for (const userId of indexedUsers) {
                if (registeredUserRoomIndex.get(userId) === roomCode) {
                    registeredUserRoomIndex.delete(userId);
                }
            }
            roomRegisteredUsersIndex.delete(roomCode);
        }
        rooms.delete(roomCode);
        clearWordPool(roomCode);
        void clearPendingRoomAdminHandoff(roomCode);
        void roomOwnership.release(roomCode).catch((error) => {
            console.error("Room ownership lease release failed", error);
        });
        publishCurrentCapacity();
    }

    function syncRegisteredUserRoomIndex(room: RoomData): void {
        const previousIndexedUsers = roomRegisteredUsersIndex.get(room.odaKodu);
        if (previousIndexedUsers) {
            for (const userId of previousIndexedUsers) {
                if (registeredUserRoomIndex.get(userId) === room.odaKodu) {
                    registeredUserRoomIndex.delete(userId);
                }
            }
        }

        const nextIndexedUsers = new Set<number>();
        for (const player of room.oyuncular) {
            if (!player.online || typeof player.userId !== "number") {
                continue;
            }

            nextIndexedUsers.add(player.userId);
            registeredUserRoomIndex.set(player.userId, room.odaKodu);
        }

        roomRegisteredUsersIndex.set(room.odaKodu, nextIndexedUsers);
    }

    function broadcastLobby(room: RoomData): void {
        const publicPlayers = room.oyuncular.map((player) => ({
            playerId: player.playerId,
            ad: player.ad,
            takim: player.takim,
            online: player.online,
            rol: player.rol,
            cosmetics: player.cosmetics ?? createEmptyPlayerCosmetics(),
        }));
        const startDecision = resolveRoomStartDecision(
            room.oyuncular.map((player) => ({
                identityType: player.identityType,
                team: player.takim,
                role: player.rol,
                online: player.online,
            }))
        );
        io.to(room.odaKodu).emit("lobiGuncelle", {
            odaKodu: room.odaKodu,
            creatorPlayerId: room.creatorPlayerId,
            oyuncular: publicPlayers,
            ayarlar: room.ayarlar,
            seciliKategoriler: room.seciliKategoriler || [],
            seciliZorluklar: room.seciliZorluklar || [],
            startReadiness: {
                ready: startDecision.allowed,
                activePlayers: startDecision.activePlayers,
                minimumPlayers: startDecision.minimumPlayers,
                teamAPlayers: startDecision.teamAPlayers,
                teamBPlayers: startDecision.teamBPlayers,
            },
        });
    }

    function buildPublicGameState(room: RoomData) {
        const narrator = room.oyunDurumu.anlatici;
        const inspector = room.oyunDurumu.gozetmen;

        return {
            oyunAktifMi: room.oyunDurumu.oyunAktifMi,
            oyunDurduruldu: room.oyunDurumu.oyunDurduruldu,
            gecisEkraninda: room.oyunDurumu.gecisEkraninda,
            mevcutTur: room.oyunDurumu.mevcutTur,
            toplamTur: room.oyunDurumu.toplamTur,
            kalanZaman: room.oyunDurumu.kalanZaman,
            kalanPasHakki: room.oyunDurumu.kalanPasHakki,
            skor: room.oyunDurumu.skor,
            anlatacakTakim: room.oyunDurumu.anlatacakTakim,
            anlatici: narrator
                ? { ad: narrator.ad, takim: narrator.takim }
                : null,
            gozetmen: inspector
                ? { ad: inspector.ad, takim: inspector.takim }
                : null,
            altinSkorAktif: room.oyunDurumu.altinSkorAktif,
            kalanGecisSuresi: room.oyunDurumu.kalanGecisSuresi ?? 0,
            toplamSure: room.ayarlar.sure,
        };
    }

    async function sendVisibleCategories(socket: Socket): Promise<void> {
        try {
            const room = getRoomBySocketId(socket.id);
            const categories = await getVisibleCategories(room?.ayarlar.wordLocale ?? "tr");
            if (Array.isArray(categories) && categories.length > 0) {
                socket.emit("kategoriListesiGonder", categories);
            }
        } catch (error) {
            console.error("Visible categories could not be sent", error);
        }
    }

    async function emitAdminHandoffStatus(roomCode: string): Promise<void> {
        const pending = await getPendingRoomAdminHandoff(roomCode);
        io.to(roomCode).emit("yoneticiDevriDurumu", pending);
    }

    // ─── Round & Turn Management ───────────────────────────────

    async function startNewRound(roomCode: string): Promise<void> {
        const room = getRoom(roomCode);
        if (!room) return;
        if (!room.oyunDurumu.oyunAktifMi) return;

        if (room.zamanlayici) {
            clearInterval(room.zamanlayici);
        }

        if (
            room.oyunDurumu.anlatacakTakim === (room.oyunDurumu.startingTeam ?? "A") &&
            !room.oyunDurumu.altinSkorAktif
        ) {
            room.oyunDurumu.mevcutTur += 1;
            if (shouldFinishTabuBeforeRound({
                settings: room.ayarlar,
                currentRound: room.oyunDurumu.mevcutTur,
                speakingTeam: room.oyunDurumu.anlatacakTakim,
                startingTeam: room.oyunDurumu.startingTeam,
                goldenScoreActive: room.oyunDurumu.altinSkorAktif,
            })) {
                finishGame(roomCode);
                return;
            }
        }

        room.oyunDurumu.gecisEkraninda = true;
        room.oyunDurumu.oyunDurduruldu = false;

        const anlatacakTakim = room.oyunDurumu.anlatacakTakim;
        const teamPlayers = room.oyuncular.filter(
            (player) =>
                player.takim === anlatacakTakim &&
                player.online &&
                player.rol !== "İzleyici"
        );

        if (teamPlayers.length === 0) {
            room.oyunDurumu.anlatacakTakim =
                anlatacakTakim === "A" ? "B" : "A";
            if (
                room.oyunDurumu.anlatacakTakim === (room.oyunDurumu.startingTeam ?? "A") &&
                !room.oyunDurumu.altinSkorAktif
            ) {
                room.oyunDurumu.mevcutTur -= 1;
            }
            persistRoom(room);
            setTimeout(() => startNewRound(roomCode), 100);
            return;
        }

        let narrator: PlayerData;
        if (anlatacakTakim === "A") {
            room.oyunDurumu.takimA_anlaticiIndex =
                (room.oyunDurumu.takimA_anlaticiIndex + 1) % teamPlayers.length;
            narrator = teamPlayers[room.oyunDurumu.takimA_anlaticiIndex];
        } else {
            room.oyunDurumu.takimB_anlaticiIndex =
                (room.oyunDurumu.takimB_anlaticiIndex + 1) % teamPlayers.length;
            narrator = teamPlayers[room.oyunDurumu.takimB_anlaticiIndex];
        }

        const opponentTeam = anlatacakTakim === "A" ? "B" : "A";
        const opponentPlayers = room.oyuncular.filter(
            (player) => player.takim === opponentTeam && player.online
        );

        const gozetmenIndex =
            anlatacakTakim === "A"
                ? room.oyunDurumu.takimB_anlaticiIndex
                : room.oyunDurumu.takimA_anlaticiIndex;

        const inspector =
            opponentPlayers.length > 0
                ? opponentPlayers[
                ((gozetmenIndex || 0) + 1) % opponentPlayers.length
                ] || opponentPlayers[0]
                : null;

        room.oyunDurumu.kalanGecisSuresi = 10;
        const transitionSnapshot: ActiveTransitionSnapshot = {
            anlatici: {
                ad: narrator.ad,
                takim: narrator.takim ?? anlatacakTakim,
            },
            gozetmen: inspector
                ? {
                    ad: inspector.ad,
                    takim: inspector.takim ?? opponentTeam,
                }
                : null,
            ilkGecis:
                room.oyunDurumu.anlatici === null &&
                room.oyunDurumu.gozetmen === null,
            cardBackTheme: null,
        };
        room.activeTransition = transitionSnapshot;
        persistRoom(room);

        const narratorCardThemes = await hydrateNarratorCardThemes(narrator.userId);
        if (
            !room.oyunDurumu.oyunAktifMi ||
            !room.oyunDurumu.gecisEkraninda ||
            room.activeTransition !== transitionSnapshot
        ) {
            return;
        }
        transitionSnapshot.cardBackTheme = narratorCardThemes.cardBackTheme;
        persistRoom(room);

        io.to(room.odaKodu).emit("turGecisiBaslat", {
            ...room.activeTransition,
            kalanSure: room.oyunDurumu.kalanGecisSuresi,
            oyunDurduruldu: room.oyunDurumu.oyunDurduruldu,
        });

        room.zamanlayici = setInterval(() => {
            const currentRoom = getRoom(roomCode);
            if (!currentRoom) {
                clearInterval(room.zamanlayici!);
                return;
            }

            if (!currentRoom.oyunDurumu.oyunDurduruldu) {
                const nextCountdown = Math.max(
                    0,
                    (currentRoom.oyunDurumu.kalanGecisSuresi ?? 0) - 1
                );
                currentRoom.oyunDurumu.kalanGecisSuresi = nextCountdown;
                io.to(roomCode).emit("turGecisDurumGuncelle", {
                    oyunDurduruldu: currentRoom.oyunDurumu.oyunDurduruldu,
                    kalanSure: currentRoom.oyunDurumu.kalanGecisSuresi,
                });

                if ((currentRoom.oyunDurumu.kalanGecisSuresi ?? 0) <= 0) {
                    clearInterval(currentRoom.zamanlayici!);
                    const narratorStillOnline = currentRoom.oyuncular.find(
                        (player) => player.id === narrator.id
                    )?.online;
                    if (narratorStillOnline) {
                        currentRoom.oyunDurumu.gecisEkraninda = false;
                        persistRoom(currentRoom);
                        startTurn(roomCode, currentRoom, narrator, inspector, narratorCardThemes);
                    } else {
                        startNewRound(roomCode);
                    }
                }
            }
        }, 1000);
    }

    async function startTurn(
        roomCode: string,
        room: RoomData | undefined,
        narrator: PlayerData,
        inspector: PlayerData | null,
        narratorCardThemes: RoomCardThemePayload
    ): Promise<void> {
        const currentRoom = room || getRoom(roomCode);
        if (!currentRoom || !narrator) return;

        currentRoom.oyunDurumu.kalanZaman = currentRoom.ayarlar.sure;
        currentRoom.oyunDurumu.anlatacakTakim =
            narrator.takim === "A" ? "B" : "A";
        currentRoom.oyunDurumu.anlatici = {
            id: narrator.id,
            playerId: narrator.playerId,
            ad: narrator.ad,
            takim: narrator.takim!,
        };
        currentRoom.oyunDurumu.gozetmen = inspector
            ? {
                id: inspector.id,
                playerId: inspector.playerId,
                ad: inspector.ad,
                takim: inspector.takim!,
            }
            : null;
        currentRoom.oyunDurumu.kalanPasHakki = 3;
        currentRoom.oyunDurumu.aktifKart = null;
        currentRoom.activeTransition = null;
        persistRoom(currentRoom);

        try {
            const draw = await getNextWord(
                currentRoom.odaKodu,
                currentRoom.gecerliKategoriIdleri,
                currentRoom.gecerliZorlukSeviyeleri,
                currentRoom.ayarlar.wordLocale
            );

            const card = draw?.card ?? null;
            currentRoom.oyunDurumu.aktifKart = card;
            currentRoom.activeWordAnalytics = draw
                ? {
                    ...draw.analytics,
                    remainingSecondsAtDisplay: currentRoom.oyunDurumu.kalanZaman,
                }
                : null;
            persistRoom(currentRoom);

            broadcastTurnInfo(currentRoom, narrator, inspector, card, narratorCardThemes);
            startTimer(currentRoom.odaKodu);
        } catch (error) {
            console.error("Failed to get next word", error);
            io.to(currentRoom.odaKodu).emit(
                "hata",
                (error as Error).message || "Kelime alınamadı."
            );
            currentRoom.oyunDurumu.oyunAktifMi = false;
            persistRoom(currentRoom);
            publishCurrentCapacity();
        }
    }

    function broadcastTurnInfo(
        room: RoomData,
        narrator: PlayerData,
        inspector: PlayerData | null,
        card: unknown,
        narratorCardThemes: RoomCardThemePayload
    ): void {
        room.oyuncular.forEach((player) => {
            if (!player.online) return;
            const playerSocket = io.sockets.sockets.get(player.id);
            if (!playerSocket) return;

            emitTurnInfoForPlayer(
                playerSocket,
                player,
                narrator,
                inspector,
                card,
                narratorCardThemes
            );
        });
    }

    function emitTurnInfoForPlayer(
        playerSocket: Socket,
        player: PlayerData,
        narrator: PlayerData | NarratorInfo,
        inspector: PlayerData | NarratorInfo | null,
        card: unknown,
        narratorCardThemes: RoomCardThemePayload
    ): void {
        let rol = "Tahminci";
        let isPrimaryGozetmen = false;

        if (player.rol === "İzleyici") {
            rol = "İzleyici";
        } else if (player.playerId === narrator.playerId) {
            rol = "Anlatıcı";
        } else if (inspector && player.playerId === inspector.playerId) {
            rol = "Gözetmen";
            isPrimaryGozetmen = true;
        }

        const shouldSeeCard =
            rol === "Anlatıcı" ||
            rol === "Gözetmen" ||
            (player.takim !== null &&
                narrator.takim !== null &&
                player.takim !== narrator.takim);

        playerSocket.emit("yeniTurBilgisi", {
            rol,
            isPrimaryGozetmen,
            kart: shouldSeeCard ? card : null,
            anlaticiAd: narrator.ad,
            gozetmenAd: inspector ? inspector.ad : "-",
            cardFaceTheme: narratorCardThemes.cardFaceTheme,
            cardBackTheme: narratorCardThemes.cardBackTheme,
        });
    }

    async function replayActiveGameState(
        socket: Socket,
        room: RoomData,
        player: PlayerData
    ): Promise<void> {
        if (room.oyunDurumu.gecisEkraninda && room.activeTransition) {
            socket.emit("turGecisiBaslat", {
                ...room.activeTransition,
                kalanSure: room.oyunDurumu.kalanGecisSuresi ?? 0,
                oyunDurduruldu: room.oyunDurumu.oyunDurduruldu,
            });
        } else if (room.oyunDurumu.anlatici) {
            const narrator = room.oyunDurumu.anlatici;
            const narratorPlayer = room.oyuncular.find(
                (entry) => entry.playerId === narrator.playerId
            );
            const narratorCardThemes = await hydrateNarratorCardThemes(
                narratorPlayer?.userId ?? null
            );
            emitTurnInfoForPlayer(
                socket,
                player,
                narrator,
                room.oyunDurumu.gozetmen,
                room.oyunDurumu.aktifKart,
                narratorCardThemes
            );
        }

        socket.emit("oyunDurumuGuncelle", buildPublicGameState(room));
    }

    function startTimer(roomCode: string): void {
        const room = getRoom(roomCode);
        if (!room) return;

        if (room.zamanlayici) {
            clearInterval(room.zamanlayici);
        }

        io.to(roomCode).emit("oyunDurumuGuncelle", buildPublicGameState(room));

        room.zamanlayici = setInterval(() => {
            const currentRoom = getRoom(roomCode);
            if (!currentRoom) {
                clearInterval(room.zamanlayici!);
                return;
            }

            if (!currentRoom.oyunDurumu.oyunDurduruldu) {
                currentRoom.oyunDurumu.kalanZaman -= 1;
                io.to(roomCode).emit(
                    "oyunDurumuGuncelle",
                    buildPublicGameState(currentRoom)
                );

                if (currentRoom.oyunDurumu.kalanZaman <= 0) {
                    consumeActiveWordAnalytics(currentRoom, "timeout");
                    startNewRound(roomCode);
                }
            }
        }, 1000);
    }

    // ─── Word Action (dogru / tabu / pas) ──────────────────────

    async function handleWordAction(
        room: RoomData,
        action: WordAction,
        socket: Socket
    ): Promise<void> {
        if (!room.activeWordAnalytics || !room.oyunDurumu.aktifKart) {
            return;
        }

        const now = Date.now();
        const lastActionAt = wordActionTimestamps.get(socket.id) || 0;
        if (now - lastActionAt < WORD_ACTION_COOLDOWN_MS) return;
        wordActionTimestamps.set(socket.id, now);

        const narrator = room.oyunDurumu.anlatici;
        if (
            !narrator ||
            room.oyunDurumu.oyunDurduruldu ||
            room.oyunDurumu.gecisEkraninda
        )
            return;

        const player = room.oyuncular.find((p) => p.id === socket.id);
        if (!player) return;

        const activeInspector = room.oyunDurumu.gozetmen;

        if (action === "tabu") {
            const isNarrator = narrator.id === player.id;
            const isPrimaryInspector = activeInspector?.id === player.id;
            if (!isNarrator && !isPrimaryInspector) return;
        }

        // Dogru and pas can only be pressed by narrator
        if (
            (action === "dogru" || action === "pas") &&
            narrator.id !== socket.id
        )
            return;

        if (action === "pas") {
            if (room.oyunDurumu.kalanPasHakki > 0) {
                room.oyunDurumu.kalanPasHakki -= 1;
            } else {
                return;
            }
        } else if (action === "dogru") {
            room.oyunDurumu.skor[narrator.takim] += 1;
        } else if (action === "tabu") {
            room.oyunDurumu.skor[narrator.takim] -= 1;
        }
        consumeActiveWordAnalytics(room, action);

        io.to(room.odaKodu).emit(
            "oyunDurumuGuncelle",
            buildPublicGameState(room)
        );

        if (
            (action === "dogru" || action === "tabu" || action === "pas") &&
            shouldFinishTabuAfterAction({
                settings: room.ayarlar,
                score: room.oyunDurumu.skor,
                actingTeam: narrator.takim,
                action,
                goldenScoreActive: room.oyunDurumu.altinSkorAktif,
            })
        ) {
            finishGame(room.odaKodu);
            return;
        }

        if (!["pas", "dogru", "tabu"].includes(action)) return;

        try {
            const draw = await getNextWord(
                room.odaKodu,
                room.gecerliKategoriIdleri,
                room.gecerliZorlukSeviyeleri,
                room.ayarlar.wordLocale
            );

            const card = draw?.card ?? null;
            room.oyunDurumu.aktifKart = card;
            room.activeWordAnalytics = draw
                ? {
                    ...draw.analytics,
                    remainingSecondsAtDisplay: room.oyunDurumu.kalanZaman,
                }
                : null;
            persistRoom(room);

            // Send card to narrator
            const narratorSocket = io.sockets.sockets.get(narrator.id);
            if (narratorSocket) {
                narratorSocket.emit("kartGuncelle", card);
            }

            // Send card to opponent team (inspectors)
            room.oyuncular.forEach((playerItem) => {
                if (playerItem.online && playerItem.takim !== narrator.takim) {
                    const s = io.sockets.sockets.get(playerItem.id);
                    if (s) {
                        s.emit("kartGuncelle", card);
                    }
                }
            });
        } catch (error) {
            console.error("Failed to fetch next card", error);
            io.to(room.odaKodu).emit(
                "hata",
                (error as Error).message || "Kelime alınamadı."
            );
        }
    }

    function consumeActiveWordAnalytics(
        room: RoomData,
        outcome: WordAnalyticsOutcome
    ): void {
        const active = room.activeWordAnalytics;
        if (!active) return;

        room.activeWordAnalytics = null;
        void recordWordAnalytics({
            occurredAt: new Date(),
            wordId: active.wordId,
            categoryIds: active.categoryIds,
            difficulty: active.difficulty,
            outcome,
            exposureSeconds: Math.max(
                0,
                active.remainingSecondsAtDisplay - room.oyunDurumu.kalanZaman
            ),
        });
    }

    // ─── Game End ──────────────────────────────────────────────

    function finishGame(roomCode: string): void {
        const room = getRoom(roomCode);
        if (!room) return;

        const finishDecision = resolveTabuFinish({
            settings: room.ayarlar,
            score: room.oyunDurumu.skor,
            goldenScoreActive: room.oyunDurumu.altinSkorAktif,
        });
        if (finishDecision.kind === "golden-score") {
            room.oyunDurumu.altinSkorAktif = true;
            persistRoom(room);
            io.to(room.odaKodu).emit("altinSkorBasladi");
            startNewRound(roomCode);
            return;
        }

        room.oyunDurumu.oyunAktifMi = false;
        room.activeTransition = null;
        room.oyunDurumu.bittiAt = Date.now();
        if (room.zamanlayici) {
            clearInterval(room.zamanlayici);
        }
        publishCurrentCapacity();

        io.to(room.odaKodu).emit("oyunBitti", {
            kazananTakim: finishDecision.winner,
            skor: room.oyunDurumu.skor,
        });
    }

    function resetGame(
        room: RoomData,
        capacitySettings: CapacitySettings
    ): void {
        if (room.zamanlayici) {
            clearInterval(room.zamanlayici);
        }
        room.oyunDurumu = createInitialGameState();
        room.oyunDurumu.kalanZaman = room.ayarlar.sure || 60;
        room.oyunDurumu.toplamTur = room.ayarlar.deger || 0;
        room.activeTransition = null;
        room.matchParticipants = [];
        room.activeWordAnalytics = null;

        room.oyuncular.forEach((player) => {
            if (player.rol !== "İzleyici" || !player.online) {
                return;
            }

            const assignedTeam = chooseJoinTeam(
                room.oyuncular.map((entry) => ({
                    identityType: entry.identityType,
                    team: entry.takim,
                    role: entry.rol,
                    online: entry.online,
                })),
                capacitySettings
            );
            if (assignedTeam) {
                player.rol = "Oyuncu";
                player.takim = assignedTeam;
            }
        });

        clearWordPool(room.odaKodu);

        io.to(room.odaKodu).emit("lobiyeDon");
        broadcastLobby(room);
    }

    // ─── Connection Handler ────────────────────────────────────

    io.on("connection", (socket: Socket) => {
        if (!isTrustedSocketOrigin(socket)) {
            socket.emit("hata", "Gecersiz baglanti origin'i.");
            socket.disconnect(true);
            return;
        }
        // ── Room Join / Create ──
        socket.on(
            "room:request",
            async (rawPayload: unknown) => {
                let claimedMembershipUserId: number | null = null;
                let claimedMembershipRoomCode: string | null = null;
                let claimedNewRoomCode: string | null = null;
                let joinedRoom = false;
                const parsed = OdaIstegiSchema.safeParse(rawPayload);
                if (!parsed.success) {
                    socket.emit("hata", "Geçersiz istek verisi.");
                    return;
                }
                const { kullaniciAdi, odaKodu, guestToken, captchaToken } = parsed.data;
                const ip = getClientIp(socket);

                // Skip rate limit check if disabled (useful for localhost/testing)
                if (RATE_LIMIT_ENABLED) {
                    const rate = await consumeDistributedRequestRateLimit({
                        bucket: "socket-room-join",
                        key: `ip:${ip}`,
                        windowMs: ROOM_JOIN_WINDOW_MS,
                        maxRequests: ROOM_JOIN_MAX_ATTEMPTS,
                    });

                    if (!rate.allowed) {
                        socket.emit(
                            "hata",
                            `Çok fazla oda denemesi yaptınız. Lütfen ${rate.retryAfterSeconds} saniye bekleyin.`
                        );
                        return;
                    }
                }

                try {
                    const socketAuthState = await getSocketAuthState(socket);
                    const socketAuthRole = socketAuthState.role;
                    if (socketAuthState.isSuspended) {
                        socket.emit(
                            "hata",
                            "Hesabiniz askiya alinmis durumda. Bu yuzeyi kullanamazsiniz."
                        );
                        return;
                    }
                    const effectiveAuthUserId = socketAuthState.userId ?? null;
                    if (effectiveAuthUserId) {
                        joinUserSessionRoom(socket, effectiveAuthUserId);
                    }
                    const requestedDisplayName = sanitizePlayerName(kullaniciAdi);
                    const registeredIdentity = effectiveAuthUserId
                        ? await resolveRegisteredIdentity(effectiveAuthUserId)
                        : null;
                    const effectiveDisplayName =
                        registeredIdentity?.displayName ?? requestedDisplayName;
                    const usernameSnapshot = registeredIdentity?.username ?? null;
                    const identityType = effectiveAuthUserId ? "registered" : "guest";

                    if (!effectiveDisplayName) {
                        socket.emit("hata", "Geçerli bir kullanıcı adı girin.");
                        return;
                    }
                    if (socketAuthState.emailVerificationRequired) {
                        socket.emit(
                            "hata",
                            "Odaya katılmak için önce e-posta adresini doğrulamalısın."
                        );
                        return;
                    }

                    const identity = resolveSocketPlayerIdentity(
                        effectiveAuthUserId,
                        guestToken
                    );
                    const effectivePlayerId = identity.playerId;

                    const requestedCode = odaKodu
                        ? String(odaKodu).toUpperCase()
                        : undefined;
                    const activeRoomCode = effectiveAuthUserId
                        ? await findOnlineRoomCodeForUser(effectiveAuthUserId)
                        : null;
                    if (activeRoomCode && activeRoomCode !== requestedCode) {
                        socket.emit(
                            "hata",
                            `Zaten ${activeRoomCode} odasindasin. Yeni oda acmadan once mevcut odana geri don.`
                        );
                        return;
                    }
                    let targetCode = requestedCode;
                    let room = targetCode ? getRoom(targetCode) : undefined;
                    if (requestedCode) {
                        const routeDecision = await roomRouting.resolve(
                            requestedCode,
                            Boolean(room)
                        );
                        if (
                            shouldRejectRoomRoute(
                                routeDecision,
                                Boolean(room)
                            )
                        ) {
                            socket.emit("hata", ROOM_ROUTING_JOIN_ERROR);
                            return;
                        }
                    }
                    const existingPlayer = room?.oyuncular.find(
                        (player) => player.playerId === effectivePlayerId
                    );
                    const settings = await getSystemSettings();
                    const roomRequestPolicy = evaluateRoomRequestPolicy({
                        settings,
                        isAuthenticated: Boolean(effectiveAuthUserId),
                        isAdmin: socketAuthRole === "admin",
                        isCreateRequest: !requestedCode,
                        isReconnect: Boolean(existingPlayer),
                    });

                    if (!roomRequestPolicy.allowed) {
                        socket.emit(
                            "hata",
                            roomRequestPolicy.message || "Bu islem su anda kullanima kapali."
                        );
                        return;
                    }

                    if (!existingPlayer) {
                        const localMetrics = getLocalRoomCapacityMetrics();
                        const cluster = await getCapacityClusterSnapshot(
                            localMetrics
                        );
                        const admission = evaluateCapacityAdmission(
                            {
                                activeRooms: cluster.activeRooms,
                                onlinePlayers: cluster.onlinePlayers,
                            },
                            settings.capacity
                        );
                        const admissionAllowed = requestedCode
                            ? admission.allowJoin
                            : admission.allowCreate;

                        if (!admissionAllowed) {
                            const message =
                                admission.message ||
                                "Sunucu şu anda yoğun. Lütfen kısa süre sonra tekrar deneyin.";
                            socket.emit("kapasiteEngeli", {
                                level: admission.level,
                                retryAfterSeconds: 30,
                                message,
                            });
                            socket.emit("hata", message);
                            return;
                        }

                        if (
                            room &&
                            room.oyuncular.filter((entry) => entry.online)
                                .length >=
                                getEffectiveRoomMaxPlayers(settings.capacity)
                        ) {
                            socket.emit(
                                "hata",
                                `Bu oda dolu. Oda kapasitesi ${getEffectiveRoomMaxPlayers(settings.capacity)} oyuncu.`
                            );
                            return;
                        }
                    }

                    const captchaAction = !requestedCode
                        ? "room_create"
                        : !effectiveAuthUserId
                            ? "guest_join"
                            : null;

                    if (captchaAction) {
                        const captchaResult = await verifyCaptchaForAction({
                            action: captchaAction,
                            token: captchaToken ?? null,
                            remoteIp: ip === "unknown" ? null : ip,
                            settings,
                        });

                        if (!captchaResult.ok) {
                            socket.emit(
                                "hata",
                                "Guvenlik dogrulamasi basarisiz. Lutfen tekrar deneyin."
                            );
                            return;
                        }
                    }

                    if (!room) {
                        if (requestedCode) {
                            socket.emit("hata", "Bu oda bulunamadı.");
                            return;
                        }
                        targetCode = await claimAvailableRoomCode();
                        claimedNewRoomCode = targetCode;
                        room = {
                            odaKodu: targetCode,
                            gameMode: TABU_MODE_ID,
                            creatorId: socket.id,
                            creatorPlayerId: effectivePlayerId,
                            oyuncular: [],
                            ayarlar: { ...TABU_DEFAULT_SETTINGS },
                            gecerliKategoriIdleri: [],
                            gecerliZorlukSeviyeleri: [],
                            oyunDurumu: createInitialGameState(),
                            activeTransition: null,
                            matchParticipants: [],
                            activeWordAnalytics: null,
                            zamanlayici: null,
                            banList: {
                                playerIds: new Set(),
                                ips: new Set(),
                            },
                        };
                    }

                    if (!room.banList) {
                        room.banList = { playerIds: new Set(), ips: new Set() };
                    }

                    if (room.banList.playerIds.has(effectivePlayerId)) {
                        socket.emit("hata", "Bu odaya yeniden katılma izniniz yok (Banlandınız).");
                        return;
                    }

                    if (ip !== "unknown" && room.banList.ips.has(ip)) {
                        socket.emit("hata", "Bu odaya yeniden katılma izniniz yok (Banlandınız).");
                        return;
                    }

                    if (effectiveAuthUserId) {
                        const membershipClaim = await claimOnlineRoomMembership(
                            effectiveAuthUserId,
                            room.odaKodu
                        );
                        if (!membershipClaim.allowed) {
                            socket.emit(
                                "hata",
                                `Zaten ${membershipClaim.currentRoomCode} odasindasin. Yeni oda acmadan once mevcut odana geri don.`
                            );
                            return;
                        }

                        claimedMembershipUserId = effectiveAuthUserId;
                        claimedMembershipRoomCode = room.odaKodu;
                    }

                    const reconnectingPlayer = room.oyuncular.find(
                        (player) => player.playerId === effectivePlayerId
                    );

                    if (reconnectingPlayer) {
                        if (reconnectingPlayer.id !== socket.id) {
                            clearSocketMembershipHeartbeat(reconnectingPlayer.id);
                        }
                        reconnectingPlayer.id = socket.id;
                        reconnectingPlayer.ad = effectiveDisplayName;
                        reconnectingPlayer.online = true;
                        reconnectingPlayer.ip = ip;
                        reconnectingPlayer.identityType = identityType;
                        reconnectingPlayer.usernameSnapshot = usernameSnapshot;
                        if (effectiveAuthUserId) {
                            reconnectingPlayer.userId = effectiveAuthUserId;
                        }
                        await hydratePlayerCosmetics(reconnectingPlayer);

                        // If this player is the creator, update the creatorId (socket ID)
                        // This fixes the issue where refreshing lost admin rights
                        if (reconnectingPlayer.playerId === room.creatorPlayerId) {
                            room.creatorId = socket.id;
                            void clearPendingRoomAdminHandoff(
                                room.odaKodu,
                                reconnectingPlayer.playerId
                            );

                            // Clear any pending admin timeout
                            const timeout = roomAdminTimeouts.get(room.odaKodu);
                            if (timeout) {
                                clearTimeout(timeout);
                                roomAdminTimeouts.delete(room.odaKodu);
                            }
                            void emitAdminHandoffStatus(room.odaKodu);
                        }

                        if (
                            room.oyunDurumu.anlatici &&
                            room.oyunDurumu.anlatici.playerId === reconnectingPlayer.playerId
                        ) {
                            room.oyunDurumu.anlatici.id = socket.id;
                        }
                    } else {
                        const isSpectator = room.oyunDurumu.oyunAktifMi;
                        const yeniOyuncu: PlayerData = {
                            id: socket.id,
                            playerId: effectivePlayerId,
                            userId: effectiveAuthUserId,
                            identityType,
                            usernameSnapshot,
                            ad: effectiveDisplayName,
                            takim: null,
                            online: true,
                            rol: isSpectator ? "İzleyici" : "Oyuncu",
                            ip,
                            cosmetics: createEmptyPlayerCosmetics(),
                        };
                        await hydratePlayerCosmetics(yeniOyuncu);

                        if (
                            room.oyuncular.filter((entry) => entry.online)
                                .length >=
                            getEffectiveRoomMaxPlayers(settings.capacity)
                        ) {
                            socket.emit(
                                "hata",
                                `Bu oda dolu. Oda kapasitesi ${getEffectiveRoomMaxPlayers(settings.capacity)} oyuncu.`
                            );
                            return;
                        }
                        const assignedTeam = isSpectator
                            ? null
                            : chooseJoinTeam(
                                room.oyuncular.map((entry) => ({
                                    identityType: entry.identityType,
                                    team: entry.takim,
                                    role: entry.rol,
                                    online: entry.online,
                                })),
                                settings.capacity
                            );
                        if (!isSpectator && assignedTeam === null) {
                            socket.emit(
                                "hata",
                                "Her iki takım da dolu. Lütfen daha sonra tekrar deneyin."
                            );
                            return;
                        }
                        yeniOyuncu.takim = assignedTeam;
                        room.oyuncular.push(yeniOyuncu);
                    }

                    socket.emit("kimlikAta", {
                        playerId: effectivePlayerId,
                        guestToken: identity.guestToken,
                    });

                    persistRoom(room);
                    socket.join(targetCode!);
                    socketToRoom.set(socket.id, targetCode!);
                    joinedRoom = true;
                    if (effectiveAuthUserId) {
                        startSocketMembershipHeartbeat(socket.id, effectiveAuthUserId, room.odaKodu);
                    }

                    await sendVisibleCategories(socket);
                    socket.emit(
                        "yoneticiDevriDurumu",
                        await getPendingRoomAdminHandoff(room.odaKodu)
                    );

                    if (room.oyunDurumu.oyunAktifMi) {
                        const currentPlayer = room.oyuncular.find(
                            (entry) => entry.playerId === effectivePlayerId
                        );
                        if (currentPlayer) {
                            await replayActiveGameState(socket, room, currentPlayer);
                        }
                    }

                    broadcastLobby(room);
                    publishCurrentCapacity();
                } catch (error) {
                    console.error("odaİsteği failed", error);
                    socket.emit(
                        "hata",
                        (error as Error).message || "Odaya katılırken hata oluştu."
                    );
                } finally {
                    if (
                        !joinedRoom &&
                        claimedMembershipUserId !== null &&
                        claimedMembershipRoomCode
                    ) {
                        await releaseOnlineRoomMembership(
                            claimedMembershipUserId,
                            claimedMembershipRoomCode
                        );
                    }
                    if (!joinedRoom && claimedNewRoomCode) {
                        await roomOwnership
                            .release(claimedNewRoomCode)
                            .catch((error) => {
                                console.error(
                                    "Uncommitted room ownership release failed",
                                    error
                                );
                            });
                    }
                }
            }
        );

        // ── Team Shuffle ──
        socket.on("narrator_order", (payload: unknown) => {
            const parsed = z.object({ playerId: z.string().min(1).max(128), direction: z.enum(["up", "down"]) }).strict().safeParse(payload);
            if (!parsed.success) return;
            const room = getRoomBySocketId(socket.id);
            if (!room || room.oyunDurumu.oyunAktifMi) return;
            const actor = room.oyuncular.find(p => p.id === socket.id);
            if (!actor || actor.playerId !== room.creatorPlayerId) return;
            const target = room.oyuncular.find(p => p.playerId === parsed.data.playerId);
            if (!target || !target.takim) return;
            const now = Date.now();
            if (now - (socket.data.lastNarratorOrderAt ?? 0) < 200) return;
            socket.data.lastNarratorOrderAt = now;
            const team = room.oyuncular.filter(p => p.takim === target.takim);
            const index = team.indexOf(target);
            const neighbour = team[index + (parsed.data.direction === "up" ? -1 : 1)];
            if (!neighbour) return;
            const a = room.oyuncular.indexOf(target);
            const b = room.oyuncular.indexOf(neighbour);
            // Synchronous swap preserves membership and cannot interleave with match start.
            [room.oyuncular[a], room.oyuncular[b]] = [room.oyuncular[b], room.oyuncular[a]];
            persistRoom(room);
            broadcastLobby(room);
        });

        socket.on("takimlariKaristir", async () => {
            const room = getRoomBySocketId(socket.id);
            if (!room) return;
            const player = room.oyuncular.find((p) => p.id === socket.id);
            if (!player || player.playerId !== room.creatorPlayerId) return;
            if (room.oyunDurumu.oyunAktifMi) {
                socket.emit("hata", "Oyun sırasında takımlar değiştirilemez.");
                return;
            }
            const lock = await runWithRoomActionLock(room.odaKodu, "shuffle-teams", 2_500, async () => {
                const settings = await getSystemSettings();
                const activePlayers = room.oyuncular.filter(
                    (entry) => entry.rol !== "İzleyici"
                );
                if (
                    activePlayers.length >
                    settings.capacity.teamMaxPlayers * 2
                ) {
                    socket.emit(
                        "hata",
                        "Takımlar mevcut kapasite ayarıyla dengelenemiyor."
                    );
                    return;
                }

                shuffleArray(activePlayers);
                const half = Math.ceil(activePlayers.length / 2);
                activePlayers.forEach((entry, index) => {
                    entry.takim = index < half ? "A" : "B";
                });
                persistRoom(room);
                broadcastLobby(room);
            });
            if (!lock.acquired) {
                socket.emit("hata", "Takimlar zaten guncelleniyor. Lutfen tekrar deneyin.");
            }
        });

        // ── Transfer Host ──
        socket.on(
            "yoneticiligiDevret",
            async (rawPayload: unknown) => {
                const parsed = PlayerTargetSchema.safeParse(rawPayload);
                if (!parsed.success) {
                    socket.emit("hata", "Geçersiz oyuncu seçimi.");
                    return;
                }
                const { targetPlayerId } = parsed.data;
                const room = getRoomBySocketId(socket.id);
                if (!room) return;
                const player = room.oyuncular.find((p) => p.id === socket.id);
                if (!player || player.playerId !== room.creatorPlayerId) return;
                const lock = await runWithRoomActionLock(room.odaKodu, "transfer-host", 2_500, async () => {
                    const newAdmin = room.oyuncular.find(
                        (player) =>
                            player.playerId === targetPlayerId && player.online
                    );
                    if (newAdmin) {
                        room.creatorId = newAdmin.id;
                        room.creatorPlayerId = newAdmin.playerId;
                        await clearPendingRoomAdminHandoff(room.odaKodu);
                        await emitAdminHandoffStatus(room.odaKodu);
                        persistRoom(room);
                        broadcastLobby(room);
                        if (room.oyunDurumu.oyunAktifMi) {
                            io.to(room.odaKodu).emit(
                                "oyunDurumuGuncelle",
                                buildPublicGameState(room)
                            );
                        }
                    }
                });
                if (!lock.acquired) {
                    socket.emit("hata", "Yoneticilik devri zaten isleniyor. Lutfen tekrar deneyin.");
                }
            }
        );

        // ── Kick Player ──
        socket.on(
            "oyuncuyuAt",
            (rawPayload: unknown) => {
                const parsed = PlayerTargetSchema.safeParse(rawPayload);
                if (!parsed.success) {
                    socket.emit("hata", "Geçersiz oyuncu seçimi.");
                    return;
                }
                const { targetPlayerId } = parsed.data;
                const room = getRoomBySocketId(socket.id);
                if (!room) return;

                const player = room.oyuncular.find((p) => p.id === socket.id);
                if (!player) return;

                if (player.playerId !== room.creatorPlayerId) return;

                const targetIndex = room.oyuncular.findIndex(
                    (player) => player.playerId === targetPlayerId
                );
                if (targetIndex === -1) return;

                const target = room.oyuncular[targetIndex];
                if (target.id === room.creatorId) return;

                if (!room.banList) {
                    room.banList = { playerIds: new Set(), ips: new Set() };
                }
                room.banList.playerIds.add(target.playerId);
                // Note: We don't have IP on Player type nicely, but we can assume simple ID ban for now 
                // We should add IP to Player type to ban properly but for now ID ban is enough
                if (target.ip && target.ip !== "unknown") {
                    room.banList.ips.add(target.ip);
                }

                if (target.id) {
                    wordActionTimestamps.delete(target.id);
                }

                const targetSocket = io.sockets.sockets.get(target.id);
                if (targetSocket) {
                    targetSocket.emit("odadanAtildin", { odaKodu: room.odaKodu });
                    try {
                        targetSocket.leave(room.odaKodu);
                        targetSocket.disconnect(true);
                    } catch (error) {
                        console.debug("Failed to disconnect kicked player", error);
                    }
                }

                room.oyuncular.splice(targetIndex, 1);

                if (room.oyuncular.length === 0) {
                    if (room.zamanlayici) clearInterval(room.zamanlayici);
                    destroyRoom(room.odaKodu);
                    return;
                }

                if (room.creatorId === target.id) {
                    const nextAdmin =
                        room.oyuncular.find((player) => player.online) ||
                        room.oyuncular[0];
                    if (nextAdmin) {
                        room.creatorId = nextAdmin.id;
                        room.creatorPlayerId = nextAdmin.playerId;
                        void clearPendingRoomAdminHandoff(room.odaKodu);
                        void emitAdminHandoffStatus(room.odaKodu);
                    }
                }

                let shouldRestartRound = false;
                if (
                    room.oyunDurumu.anlatici &&
                    room.oyunDurumu.anlatici.playerId === target.playerId
                ) {
                    room.oyunDurumu.anlatici = null;
                    shouldRestartRound = true;
                }

                persistRoom(room);
                broadcastLobby(room);

                const onlinePlayers = room.oyuncular.filter(
                    (player) => player.online
                );
                if (onlinePlayers.length === 0) {
                    if (room.zamanlayici) clearInterval(room.zamanlayici);
                    destroyRoom(room.odaKodu);
                    return;
                }

                if (room.oyunDurumu.oyunAktifMi) {
                    if (shouldRestartRound) {
                        startNewRound(room.odaKodu);
                    } else {
                        io.to(room.odaKodu).emit(
                            "oyunDurumuGuncelle",
                            buildPublicGameState(room)
                        );
                    }
                }
            }
        );

        // ── Start Game ──
        const startGameHandler = async (rawPayload: unknown) => {
                const parsed = StartGameSchema.safeParse(rawPayload);
                if (!parsed.success) {
                    socket.emit("hata", "Geçersiz oyun başlangıç ayarları.");
                    return;
                }
                const {
                    seciliKategoriler,
                    seciliZorluklar,
                    ayarlar,
                } = parsed.data;
                const room = getRoomBySocketId(socket.id);
                if (!room) return;
                const player = room.oyuncular.find((p) => p.id === socket.id);
                if (!player || player.playerId !== room.creatorPlayerId) return;
                const lock = await runWithRoomActionLock(room.odaKodu, "start-game", 4_000, async () => {
                    if (room.oyunDurumu.oyunAktifMi) {
                        socket.emit("hata", "Oyun zaten devam ediyor.");
                        return;
                    }
                    const startDecision = resolveRoomStartDecision(
                        room.oyuncular.map((entry) => ({
                            identityType: entry.identityType,
                            team: entry.takim,
                            role: entry.rol,
                            online: entry.online,
                        }))
                    );
                    if (!startDecision.allowed) {
                        socket.emit("hata", startDecision.message);
                        return;
                    }

                    room.ayarlar = normalizeTabuRoomSettings(ayarlar);
                    const visibleCategoryIds = collectVisibleCategoryIds(
                        await getVisibleCategories(room.ayarlar.wordLocale)
                    );
                    const allowedCategoryIds = [
                        ...new Set(seciliKategoriler),
                    ].filter((categoryId) =>
                        visibleCategoryIds.has(categoryId)
                    );

                    room.gecerliKategoriIdleri = allowedCategoryIds;
                    room.gecerliZorlukSeviyeleri = seciliZorluklar;

                    if (
                        !room.gecerliKategoriIdleri ||
                        room.gecerliKategoriIdleri.length === 0
                    ) {
                        socket.emit("hata", "Lütfen en az bir kategori seçin.");
                        return;
                    }
                    if (
                        !room.gecerliZorlukSeviyeleri ||
                        room.gecerliZorlukSeviyeleri.length === 0
                    ) {
                        socket.emit("hata", "Lütfen en az bir zorluk seviyesi seçin.");
                        return;
                    }

                    const toplamTur =
                        room.ayarlar.mod === "tur" ? room.ayarlar.deger : 0;

                    room.matchParticipants = room.oyuncular
                        .filter(
                            (entry) =>
                                entry.online &&
                                entry.rol !== "İzleyici" &&
                                (entry.takim === "A" ||
                                    entry.takim === "B")
                        )
                        .map((entry) => ({
                            playerId: entry.playerId,
                            userId: entry.userId,
                            identityType: entry.identityType,
                            usernameSnapshot: entry.usernameSnapshot,
                            displayNameSnapshot: entry.ad,
                            teamAtStart: entry.takim as "A" | "B",
                            roleAtStart: entry.rol as MatchParticipantSnapshot["roleAtStart"],
                        }));
                    room.activeWordAnalytics = null;

                    const startingTeam = randomInt(2) === 0 ? "A" : "B";
                    room.oyunDurumu = {
                        ...room.oyunDurumu,
                        oyunAktifMi: true,
                        skor: { A: 0, B: 0 },
                        mevcutTur: 0,
                        toplamTur,
                        anlatacakTakim: startingTeam,
                        startingTeam,
                        takimA_anlaticiIndex: -1,
                        takimB_anlaticiIndex: -1,
                        altinSkorAktif: false,
                        basladiAt: Date.now(),
                        bittiAt: null,
                    };

                    persistRoom(room);
                    publishCurrentCapacity();
                    io.to(room.odaKodu).emit("oyunBasladi");
                    startNewRound(room.odaKodu);
                });
                if (!lock.acquired) {
                    socket.emit("hata", "Oyun zaten baslatiliyor. Lutfen bekleyin.");
                }
            };
        for (const eventName of ROOM_START_GAME_EVENTS) {
            socket.on(eventName, startGameHandler);
        }

        // ── Pause / Resume ──
        const gameControlHandler = async () => {
            const room = getRoomBySocketId(socket.id);
            if (!room) return;
            const player = room.oyuncular.find((p) => p.id === socket.id);
            if (!player || player.playerId !== room.creatorPlayerId) return;
            const lock = await runWithRoomActionLock(room.odaKodu, "game-control", 2_500, async () => {
                room.oyunDurumu.oyunDurduruldu = !room.oyunDurumu.oyunDurduruldu;
                persistRoom(room);

                if (room.oyunDurumu.gecisEkraninda) {
                    io.to(room.odaKodu).emit("turGecisDurumGuncelle", {
                        oyunDurduruldu: room.oyunDurumu.oyunDurduruldu,
                        kalanSure: room.oyunDurumu.kalanGecisSuresi,
                    });
                } else if (room.oyunDurumu.oyunAktifMi) {
                    if (room.oyunDurumu.oyunDurduruldu && room.zamanlayici) {
                        clearInterval(room.zamanlayici);
                    } else {
                        startTimer(room.odaKodu);
                    }
                    io.to(room.odaKodu).emit(
                        "oyunDurumuGuncelle",
                        buildPublicGameState(room)
                    );
                }
            });
            if (!lock.acquired) {
                socket.emit("hata", "Oyun kontrol islemi zaten isleniyor. Lutfen bekleyin.");
            }
        };
        for (const eventName of ROOM_GAME_CONTROL_EVENTS) {
            socket.on(eventName, gameControlHandler);
        }

        // ── Word Action ──
        socket.on(
            "oyunVerisi",
            async (rawPayload: unknown) => {
                const parsed = OyunVerisiSchema.safeParse(rawPayload);
                if (!parsed.success) return;
                const room = getRoomBySocketId(socket.id);
                if (!room || !room.oyunDurumu.oyunAktifMi) return;
                await runWithRoomActionLock(
                    room.odaKodu,
                    "word-action",
                    2_500,
                    () => handleWordAction(room, parsed.data.eylem, socket)
                );
            }
        );

        // ── Reset Game ──
        const resetGameHandler = async () => {
            const room = getRoomBySocketId(socket.id);
            if (!room) return;
            const player = room.oyuncular.find((p) => p.id === socket.id);

            // Allow reset if admin OR game is not active (just in case)
            // But strict admin check is safer for "reset game"
            if (!player || player.playerId !== room.creatorPlayerId) return;

            const lock = await runWithRoomActionLock(room.odaKodu, "reset-game", 4_000, async () => {
                const settings = await getSystemSettings();
                resetGame(room, settings.capacity);
                persistRoom(room);
            });
            if (!lock.acquired) {
                socket.emit("hata", "Oyun zaten sifirlaniyor. Lutfen bekleyin.");
            }
        };
        for (const eventName of ROOM_RESET_GAME_EVENTS) {
            socket.on(eventName, resetGameHandler);
        }

        // ── Switch Team ──
        const switchTeamHandler = async () => {
            const room = getRoomBySocketId(socket.id);
            if (!room || room.oyunDurumu.oyunAktifMi) return;

            const player = room.oyuncular.find((p) => p.id === socket.id);
            if (
                !player ||
                player.rol === "İzleyici" ||
                (player.takim !== "A" && player.takim !== "B")
            ) {
                return;
            }

            await runWithRoomActionLock(
                room.odaKodu,
                "switch-team",
                2_500,
                async () => {
                    if (room.oyunDurumu.oyunAktifMi) {
                        return;
                    }
                    const targetTeam = player.takim === "A" ? "B" : "A";
                    const settings = await getSystemSettings();
                    const canMove = canMoveToTeam(
                        room.oyuncular.map((entry) => ({
                            identityType: entry.identityType,
                            team: entry.takim,
                            role: entry.rol,
                            online: entry.online,
                        })),
                        targetTeam,
                        settings.capacity
                    );
                    if (!canMove) {
                        socket.emit(
                            "hata",
                            `${targetTeam} takımı dolu. Takım başına en fazla ${settings.capacity.teamMaxPlayers} oyuncu olabilir.`
                        );
                        return;
                    }

                    player.takim = targetTeam;
                    persistRoom(room);
                    broadcastLobby(room);
                }
            );
        };
        for (const eventName of ROOM_SWITCH_TEAM_EVENTS) {
            socket.on(eventName, switchTeamHandler);
        }

        socket.on(
            ROOM_UPDATE_DISPLAY_NAME_EVENT,
            (
                rawPayload: unknown,
                callback?: (response: {
                    ok: boolean;
                    error?: string;
                    displayName?: string;
                }) => void
            ) => {
                if (
                    !consumeSocketActionBurstLimit(
                        socket.id,
                        ROOM_UPDATE_DISPLAY_NAME_EVENT
                    )
                ) {
                    callback?.({
                        ok: false,
                        error: "Çok fazla isim değişikliği isteği gönderdin. Biraz bekleyip tekrar dene.",
                    });
                    return;
                }

                const parsed = DisplayNameUpdateSchema.safeParse(rawPayload);
                if (!parsed.success) {
                    callback?.({ ok: false, error: "Gecerli bir gorunen ad girin." });
                    return;
                }

                const room = getRoomBySocketId(socket.id);
                if (!room) {
                    callback?.({ ok: false, error: "Lobi bulunamadi." });
                    return;
                }

                if (room.oyunDurumu.oyunAktifMi) {
                    callback?.({
                        ok: false,
                        error: "Mac basladiktan sonra gorunen ad degistirilemez.",
                    });
                    return;
                }

                const player = room.oyuncular.find((entry) => entry.id === socket.id);
                if (!player) {
                    callback?.({ ok: false, error: "Oyuncu bulunamadi." });
                    return;
                }

                const nextDisplayName = sanitizePlayerName(parsed.data.displayName);
                if (!nextDisplayName) {
                    callback?.({ ok: false, error: "Gecerli bir gorunen ad girin." });
                    return;
                }

                player.ad = nextDisplayName;
                persistRoom(room);
                broadcastLobby(room);

                callback?.({
                    ok: true,
                    displayName: nextDisplayName,
                });
            }
        );

        // ── Update Category Settings ──
        socket.on(
            "kategoriAyarlariGuncelle",
            async (rawPayload: unknown) => {
                const parsed = KategoriAyarlariSchema.safeParse(rawPayload);
                if (!parsed.success) {
                    socket.emit("hata", "Geçersiz kategori verisi.");
                    return;
                }
                const { seciliKategoriler, seciliZorluklar, wordLocale } = parsed.data;
                const room = getRoomBySocketId(socket.id);
                if (!room) return;
                const player = room.oyuncular.find((p) => p.id === socket.id);
                if (!player || player.playerId !== room.creatorPlayerId) return;
                if (room.oyunDurumu.oyunAktifMi) return;

                await runWithRoomActionLock(
                    room.odaKodu,
                    "category-settings",
                    2_500,
                    async () => {
                        if (room.oyunDurumu.oyunAktifMi) {
                            return;
                        }
                        const previousLocale = room.ayarlar.wordLocale;
                        if (wordLocale) {
                            room.ayarlar = normalizeTabuRoomSettings({
                                ...room.ayarlar,
                                wordLocale,
                            });
                        }
                        const visibleCategories = await getVisibleCategories(room.ayarlar.wordLocale);
                        const visibleCategoryIds = collectVisibleCategoryIds(visibleCategories);
                        room.seciliKategoriler = [
                            ...new Set(seciliKategoriler),
                        ].filter((categoryId) =>
                            visibleCategoryIds.has(categoryId)
                        );
                        room.seciliZorluklar = seciliZorluklar;
                        if (previousLocale !== room.ayarlar.wordLocale) {
                            clearWordPool(room.odaKodu);
                            room.seciliKategoriler = [];
                            io.to(room.odaKodu).emit("kategoriListesiGonder", visibleCategories);
                        }
                        persistRoom(room);

                        io.to(room.odaKodu).emit(
                            "kategoriAyarlariGuncellendi",
                            {
                                seciliKategoriler: room.seciliKategoriler,
                                seciliZorluklar: room.seciliZorluklar,
                                wordLocale: room.ayarlar.wordLocale,
                            }
                        );
                    }
                );
            }
        );

        // ── Disconnect ──
        socket.on("disconnect", async () => {
            wordActionTimestamps.delete(socket.id);
            clearSocketActionBurstLimits(socket.id);
            clearSocketMembershipHeartbeat(socket.id);
            const roomCode = socketToRoom.get(socket.id);
            const room = roomCode ? getRoom(roomCode) : undefined;
            socketToRoom.delete(socket.id);
            if (!room) return;

            const player = room.oyuncular.find((p) => p.id === socket.id);
            if (!player) return;

            player.online = false;
            publishCurrentCapacity();
            if (typeof player.userId === "number") {
                const hasOtherOnlineSession = room.oyuncular.some(
                    (entry) =>
                        entry.id !== socket.id &&
                        entry.userId === player.userId &&
                        entry.online
                );

                if (!hasOtherOnlineSession) {
                    await releaseOnlineRoomMembership(player.userId, room.odaKodu);
                }
            }
            const onlinePlayers = room.oyuncular.filter((p) => p.online);

            if (onlinePlayers.length === 0) {
                // Grace period: wait 15 seconds before destroying room
                // This prevents race condition when homepage disconnects
                // its socket before the /room/[code] page reconnects
                const roomCode = room.odaKodu;
                setTimeout(() => {
                    const currentRoom = getRoom(roomCode);
                    if (!currentRoom) return;
                    const stillOnline = currentRoom.oyuncular.filter(
                        (p) => p.online
                    );
                    if (stillOnline.length === 0) {
                        if (currentRoom.zamanlayici)
                            clearInterval(currentRoom.zamanlayici);

                        // Clear admin timeout
                        const timeout = roomAdminTimeouts.get(roomCode);
                        if (timeout) {
                            clearTimeout(timeout);
                            roomAdminTimeouts.delete(roomCode);
                        }

                        destroyRoom(roomCode);
                    }
                }, 15_000);
                return;
            }

            if (room.creatorId === socket.id) {
                // Admin Disconnect Logic
                // Start Timeout to transfer admin
                const roomCode = room.odaKodu; // Capture room code for timeout closure
                void setPendingRoomAdminHandoff(
                    roomCode,
                    room.creatorPlayerId,
                    ADMIN_TIMEOUT_MS
                );
                void emitAdminHandoffStatus(roomCode);

                const timeout = setTimeout(() => {
                    const currentRoom = getRoom(roomCode); // Use room code instead of socket.id
                    if (!currentRoom) {
                        roomAdminTimeouts.delete(roomCode);
                        return;
                    }

                    // Check if admin still offline
                    const adminPlayer = currentRoom.oyuncular.find(p => p.playerId === currentRoom.creatorPlayerId);
                    if (adminPlayer && !adminPlayer.online) {
                        const nextAdmin = currentRoom.oyuncular.find(p => p.online);
                        if (nextAdmin) {
                            currentRoom.creatorId = nextAdmin.id;
                            currentRoom.creatorPlayerId = nextAdmin.playerId;
                            void clearPendingRoomAdminHandoff(
                                roomCode,
                                adminPlayer.playerId
                            );
                            void emitAdminHandoffStatus(roomCode);
                            persistRoom(currentRoom);
                            broadcastLobby(currentRoom);
                            io.to(roomCode).emit("hata", `Yönetici süresi doldu. Yeni yönetici: ${nextAdmin.ad}`);
                        }
                    } else if (adminPlayer) {
                        void clearPendingRoomAdminHandoff(
                            roomCode,
                            adminPlayer.playerId
                        );
                        void emitAdminHandoffStatus(roomCode);
                    }
                    roomAdminTimeouts.delete(roomCode);

                }, ADMIN_TIMEOUT_MS);

                roomAdminTimeouts.set(room.odaKodu, timeout);
            }

            persistRoom(room);
            broadcastLobby(room);
            if (room.oyunDurumu.oyunAktifMi) {
                io.to(room.odaKodu).emit(
                    "oyunDurumuGuncelle",
                    buildPublicGameState(room)
                );
            }
        });
    });
}

// ─── Metrics ───────────────────────────────────────────────────

export function getRoomMetrics(): {
    aktifLobiSayisi: number;
    onlineKullaniciSayisi: number;
    aktifMacSayisi: number;
    izleyiciSayisi: number;
    bagliSocketSayisi: number;
} {
    let onlineKullaniciSayisi = 0;
    let aktifMacSayisi = 0;
    let izleyiciSayisi = 0;
    rooms.forEach((room) => {
        onlineKullaniciSayisi += room.oyuncular.filter(
            (player) => player.online
        ).length;
        izleyiciSayisi += room.oyuncular.filter(
            (player) => player.online && player.rol === "İzleyici"
        ).length;
        if (room.oyunDurumu.oyunAktifMi) {
            aktifMacSayisi += 1;
        }
    });

    return {
        aktifLobiSayisi: rooms.size,
        onlineKullaniciSayisi,
        aktifMacSayisi,
        izleyiciSayisi,
        bagliSocketSayisi: connectedSocketCountGetter(),
    };
}

export function getLocalRoomCapacityMetrics() {
    const metrics = getRoomMetrics();
    return {
        activeRooms: metrics.aktifLobiSayisi,
        activeMatches: metrics.aktifMacSayisi,
        onlinePlayers: metrics.onlineKullaniciSayisi,
        spectators: metrics.izleyiciSayisi,
        connectedSockets: metrics.bagliSocketSayisi,
    };
}

export async function findOnlineRoomCodeForUser(userId: number): Promise<string | null> {
    return (await getOnlineRoomMembership(userId)) ?? registeredUserRoomIndex.get(userId) ?? null;
}

function createEmptyPlayerCosmetics(): PlayerCosmetics {
    return {
        avatarImageUrl: null,
        frameImageUrl: null,
        frameAccentColor: null,
    };
}

function isSecureSocketHandshake(socket: Socket): boolean {
    const forwardedProto = socket.handshake.headers["x-forwarded-proto"];
    const normalizedProto = Array.isArray(forwardedProto)
        ? forwardedProto[0]
        : forwardedProto;

    if (typeof normalizedProto === "string") {
        return normalizedProto.split(",")[0].trim() === "https";
    }

    const origin = socket.handshake.headers.origin;
    if (typeof origin === "string") {
        return origin.startsWith("https://");
    }

    return process.env.NODE_ENV === "production";
}

function isTrustedSocketOrigin(socket: Socket): boolean {
    const origin = socket.handshake.headers.origin;
    return isTrustedWebOrigin({
        origin: typeof origin === "string" ? origin : undefined,
        isDev: process.env.NODE_ENV !== "production",
        trustedOrigins: parseTrustedWebOrigins(),
        allowMissingOrigin: allowOriginlessSocketClients(
            process.env.NODE_ENV !== "production"
        ),
    });
}

async function getSocketAuthState(socket: Socket): Promise<{
    userId: number | null;
    role: string | null;
    isSuspended: boolean;
    emailVerificationRequired: boolean;
}> {
    const cookieHeader = socket.handshake.headers.cookie;
    if (!cookieHeader || !process.env.AUTH_SECRET) {
        return {
            userId: null,
            role: null,
            isSuspended: false,
            emailVerificationRequired: false,
        };
    }

    const token = await getToken({
        req: {
            headers: {
                cookie: cookieHeader,
            },
        },
        secret: process.env.AUTH_SECRET,
        secureCookie: isSecureSocketHandshake(socket),
    });

    const userId = Number(token?.sub);
    if (!Number.isInteger(userId) || userId <= 0) {
        return {
            userId: null,
            role: null,
            isSuspended: false,
            emailVerificationRequired: false,
        };
    }

    await clearExpiredSuspensions();
    const user = await prisma.user.findUnique({
        where: { id: userId },
        select: {
            id: true,
            role: true,
            sessionVersion: true,
            isSuspended: true,
            suspendedUntil: true,
            accountStatus: true,
            emailVerifiedAt: true,
            emailVerificationRequiredAt: true,
        },
    });

    if (
        !user ||
        typeof token?.sessionVersion !== "number" ||
        token.sessionVersion !== user.sessionVersion
    ) {
        return {
            userId: null,
            role: null,
            isSuspended: false,
            emailVerificationRequired: false,
        };
    }

    return {
        userId: isSuspensionActive(user) ? null : user.id,
        role: isSuspensionActive(user) ? null : user.role,
        isSuspended: isSuspensionActive(user),
        emailVerificationRequired:
            isEmailVerificationRestrictionActive(user),
    };
}

async function hydrateNarratorCardThemes(userId: number | null): Promise<RoomCardThemePayload> {
    if (!userId) {
        return createEmptyRoomCardThemes();
    }

    try {
        const snapshot = await getPlayerCardCosmeticsSnapshot(userId);
        return resolveRoomCardThemes(snapshot);
    } catch (error) {
        console.error("Narrator card cosmetics could not be loaded", error);
        return createEmptyRoomCardThemes();
    }
}

async function hydratePlayerCosmetics(player: PlayerData): Promise<void> {
    if (!player.userId) {
        player.cosmetics = createEmptyPlayerCosmetics();
        return;
    }

    try {
        player.cosmetics = await getPlayerAppearanceSnapshot(player.userId);
    } catch (error) {
        console.error("Player cosmetics could not be loaded", error);
        player.cosmetics = createEmptyPlayerCosmetics();
    }
}

async function resolveRegisteredIdentity(userId: number): Promise<{
    username: string;
    displayName: string;
} | null> {
    const user = await prisma.user.findUnique({
        where: { id: userId },
        select: {
            username: true,
            profile: {
                select: {
                    displayName: true,
                },
            },
        },
    });

    if (!user) {
        return null;
    }

    return {
        username: user.username,
        displayName: sanitizePlayerName(user.profile?.displayName || user.username),
    };
}

export function getRoomMatchSnapshot(roomCode: string): RoomMatchSnapshot | null {
    const room = rooms.get(roomCode);
    if (!room) return null;
    const startedAt = room.oyunDurumu.basladiAt ?? null;
    const endedAt = room.oyunDurumu.bittiAt ?? null;
    const sureSeconds =
        startedAt !== null
            ? Math.max(0, Math.round(((endedAt ?? Date.now()) - startedAt) / 1000))
            : null;
    const matchParticipants =
        room.matchParticipants?.length > 0
            ? room.matchParticipants
            : room.oyuncular
                .filter(
                    (player) =>
                        player.rol !== "İzleyici" &&
                        (player.takim === "A" || player.takim === "B")
                )
                .map((player) => ({
                    playerId: player.playerId,
                    userId: player.userId,
                    identityType: player.identityType,
                    usernameSnapshot: player.usernameSnapshot,
                    displayNameSnapshot: player.ad,
                    teamAtStart: player.takim as "A" | "B",
                    roleAtStart: player.rol as MatchParticipantSnapshot["roleAtStart"],
                }));
    return {
        odaKodu: room.odaKodu,
        gameMode: room.gameMode ?? TABU_MODE_ID,
        oyunAktifMi: room.oyunDurumu.oyunAktifMi,
        skor: room.oyunDurumu.skor,
        matchStartedAt: startedAt !== null ? new Date(startedAt).toISOString() : null,
        matchEndedAt: endedAt !== null ? new Date(endedAt).toISOString() : null,
        sureSeconds,
        matchFormat: room.ayarlar.mod,
        matchTarget: room.ayarlar.deger,
        oyuncular: matchParticipants.map((player) => ({
            playerId: player.playerId,
            userId: player.userId ?? null,
            identityType: player.identityType,
            usernameSnapshot: player.usernameSnapshot,
            ad: player.displayNameSnapshot,
            takim: player.teamAtStart,
            roleAtStart: player.roleAtStart,
        })),
    };
}
