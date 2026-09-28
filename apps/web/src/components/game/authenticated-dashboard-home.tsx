"use client";

import { useEffect, useState } from "react";
import { io, Socket } from "socket.io-client";
import { useRouter } from "next/navigation";
import Image from "next/image";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Separator } from "@/components/ui/separator";
import {
  Gamepad2,
  Plus,
  LogIn,
  Sparkles,
  Moon,
  Sun,
  Megaphone,
  LogOut,
  Settings,
  UserRound,
  ArrowRight,
  ShieldAlert,
} from "lucide-react";
import { useTheme } from "next-themes";
import { useSession, signOut } from "next-auth/react";
import { AnnouncementsModal } from "@/components/game/announcements-modal";
import { DashboardLayout } from "@/components/game/dashboard-overlay";
import type { DashboardTab } from "@/components/game/dashboard-nav";
import { useBranding } from "@/components/providers/branding-provider";
import { LanguageSwitcher } from "@/components/i18n/language-switcher";
import { useI18n } from "@/components/providers/i18n-provider";
import { getFreshActiveRoomCodeFromPresence } from "@/lib/client/active-room-presence";
import {
  getCaptchaTokenForAction,
  prewarmCaptchaForAction,
} from "@/lib/security/captcha-client";
import {
  SOCKET_CLIENT_AUTH,
  getSocketProtocolErrorMessage,
} from "@/lib/socket/protocol-version";
import type { PendingAdminHandoffState } from "@/types/game";

interface SocketIdentityPayload {
  playerId: string;
  guestToken: string | null;
}

interface AuthenticatedDashboardHomeProps {
  defaultTab?: DashboardTab;
}

interface ActiveRoomContext {
  roomCode: string | null;
  pendingAdminHandoff: PendingAdminHandoffState | null;
  requiresHostReturn: boolean;
}

export function AuthenticatedDashboardHome({
  defaultTab = "dash",
}: AuthenticatedDashboardHomeProps) {
  const [roomCode, setRoomCode] = useState("");
  const [error, setError] = useState("");
  const [isConnecting, setIsConnecting] = useState(false);
  const [showAnnouncements, setShowAnnouncements] = useState(false);
  const [activeRoomContext, setActiveRoomContext] = useState<ActiveRoomContext | null>(null);
  const [activeRoomLoading, setActiveRoomLoading] = useState(true);
  const { resolvedTheme, setTheme } = useTheme();
  const router = useRouter();
  const { data: session } = useSession();
  const branding = useBranding();
  const { t } = useI18n();
  const sessionUsername = session?.user?.name || "";

  async function getServerActiveRoomContext(): Promise<ActiveRoomContext | null> {
    try {
      const response = await fetch("/api/user/active-room", {
        method: "GET",
        cache: "no-store",
        credentials: "same-origin",
      });

      if (!response.ok) {
        return null;
      }

      const payload = (await response.json()) as {
        roomCode?: string | null;
        pendingAdminHandoff?: PendingAdminHandoffState | null;
        requiresHostReturn?: boolean;
      };

      return {
        roomCode:
          typeof payload.roomCode === "string" && payload.roomCode.length > 0
            ? payload.roomCode
            : null,
        pendingAdminHandoff: payload.pendingAdminHandoff ?? null,
        requiresHostReturn: payload.requiresHostReturn === true,
      };
    } catch {
      return null;
    }
  }

  useEffect(() => {
    if (!session?.user) {
      return;
    }

    let cancelled = false;

    async function loadActiveRoomContext() {
      setActiveRoomLoading(true);
      const nextContext = await getServerActiveRoomContext();
      if (cancelled) {
        return;
      }

      setActiveRoomContext(nextContext);
      setActiveRoomLoading(false);
    }

    void loadActiveRoomContext();

    return () => {
      cancelled = true;
    };
  }, [session?.user]);

  if (!session?.user) {
    return null;
  }

  const handleJoinOrCreate = async (isCreate: boolean) => {
    const currentUsername = (
      window.localStorage.getItem("tabu_username") || sessionUsername
    ).trim();
    const currentPath = window.location.pathname;
    const activeRoomPresenceKey = session.user.id ? `tabu_active_room_presence:${session.user.id}` : null;
    const serverActiveRoomContext = await getServerActiveRoomContext();
    const serverActiveRoomCode = serverActiveRoomContext?.roomCode ?? null;

    if (!currentPath.startsWith("/room")) {
      window.sessionStorage.removeItem("tabu_activeRoomCode");
    }

    if (serverActiveRoomCode) {
      setError(t("home.activeRoomConflict", { code: serverActiveRoomCode }));
      return;
    }

    if (activeRoomPresenceKey) {
      const activeRoomCodeFromPresence = getFreshActiveRoomCodeFromPresence(
        activeRoomPresenceKey,
        window.localStorage
      );
      if (activeRoomCodeFromPresence) {
        setError(t("home.activeRoomConflict", { code: activeRoomCodeFromPresence }));
        return;
      }
    }

    if (!currentUsername) {
      setError(t("home.usernameRequired"));
      return;
    }
    if (!isCreate && !roomCode.trim()) {
      setError(t("home.roomCodeRequired"));
      return;
    }

    setIsConnecting(true);
    setError("");

    try {
      const { token } = isCreate
        ? await getCaptchaTokenForAction("room_create")
        : { token: null as string | null };

      const socket: Socket = io({
        path: "/api/socketio",
        auth: SOCKET_CLIENT_AUTH,
        transports: ["websocket", "polling"],
        tryAllTransports: true,
      });

      socket.on("connect", () => {
        socket.emit("room:request", {
          kullaniciAdi: currentUsername,
          odaKodu: isCreate ? undefined : roomCode.trim().toUpperCase(),
          ...(token ? { captchaToken: token } : {}),
        });
      });

      socket.on("kimlikAta", ({ playerId, guestToken }: SocketIdentityPayload) => {
        window.sessionStorage.setItem("tabu_playerId", playerId);
        if (guestToken) {
          window.sessionStorage.setItem("tabu_guestToken", guestToken);
        } else {
          window.sessionStorage.removeItem("tabu_guestToken");
        }
      });

      socket.on("lobiGuncelle", (data: { odaKodu: string }) => {
        localStorage.setItem("tabu_username", currentUsername);
        localStorage.setItem("tabu_roomCode", data.odaKodu);
        socket.disconnect();
        router.push(`/room/${data.odaKodu}`);
      });

      socket.on("hata", (message: string) => {
        setError(message);
        setIsConnecting(false);
        socket.disconnect();
      });

      socket.on("connect_error", (error) => {
        setError(
          getSocketProtocolErrorMessage(error) ??
            t("home.connectionFailed")
        );
        setIsConnecting(false);
      });
    } catch {
      setError(t("home.securityFailed"));
      setIsConnecting(false);
    }
  };

  const playContent = (
    <div className="flex h-full items-center justify-center p-4 md:p-6">
      <div className="w-full max-w-md space-y-8">
        {activeRoomContext?.roomCode ? (
          <div className="rounded-2xl border border-amber-200 bg-amber-50/95 p-4 text-amber-950 shadow-sm dark:border-amber-900/60 dark:bg-amber-950/30 dark:text-amber-100">
            <div className="flex items-start gap-3">
              <div className="mt-0.5 rounded-full bg-amber-100 p-2 text-amber-700 dark:bg-amber-900/50 dark:text-amber-200">
                {activeRoomContext.requiresHostReturn ? (
                  <ShieldAlert className="h-4 w-4" />
                ) : (
                  <Gamepad2 className="h-4 w-4" />
                )}
              </div>
              <div className="min-w-0 flex-1">
                <div className="text-xs font-black uppercase tracking-[0.18em] text-amber-700/80 dark:text-amber-300/80">
                  {t("home.activeRoomTitle")}
                </div>
                <div className="mt-1 text-sm font-semibold">
                  {t("home.activeRoomReturn", { code: activeRoomContext.roomCode })}
                </div>
                <div className="mt-1 text-xs text-amber-800/80 dark:text-amber-200/80">
                  {activeRoomContext.requiresHostReturn
                    ? t("home.activeRoomHostHelp")
                    : t("home.activeRoomHelp")}
                </div>
                <Button
                  type="button"
                  onClick={() => router.push(`/room/${activeRoomContext.roomCode}`)}
                  className="mt-3 h-10 rounded-xl bg-amber-600 px-4 font-bold text-white hover:bg-amber-700"
                >
                  <ArrowRight className="mr-2 h-4 w-4" />
                  {t("home.returnRoom")}
                </Button>
              </div>
            </div>
          </div>
        ) : activeRoomLoading ? (
          <div className="rounded-2xl border border-slate-200/80 bg-white/70 p-4 text-center text-sm text-slate-500 shadow-sm dark:border-slate-700/60 dark:bg-slate-900/40 dark:text-slate-300">
            {t("home.checkingRoom")}
          </div>
        ) : null}

        <div className="space-y-3 text-center">
          <div className="mx-auto flex h-16 w-16 items-center justify-center rounded-2xl bg-gradient-to-br from-purple-500 to-blue-600 shadow-lg shadow-purple-500/20">
            <Gamepad2 className="h-8 w-8 text-white" />
          </div>
          <div>
            <h2 className="text-2xl font-black tracking-tight text-foreground">{t("home.playTitle")}</h2>
            <p className="mt-1 text-sm text-muted-foreground">{t("home.playDescription")}</p>
          </div>
        </div>

        <Button
          onClick={() => handleJoinOrCreate(true)}
          onFocus={() => prewarmCaptchaForAction("room_create")}
          onPointerEnter={() => prewarmCaptchaForAction("room_create")}
          disabled={isConnecting}
          className="h-14 w-full rounded-xl bg-gradient-to-r from-purple-600 to-blue-600 text-base font-bold shadow-lg shadow-purple-500/20 transition-all duration-200 hover:from-purple-700 hover:to-blue-700 hover:shadow-xl"
        >
          {isConnecting ? (
            <div className="flex items-center gap-2">
              <div className="h-4 w-4 animate-spin rounded-full border-2 border-white border-t-transparent" />
              {t("home.connecting")}
            </div>
          ) : (
            <div className="flex items-center gap-2">
              <Plus className="h-5 w-5" />
              {t("home.createRoom")}
            </div>
          )}
        </Button>

        <div className="flex items-center gap-3">
          <Separator className="flex-1" />
          <span className="text-xs font-medium uppercase tracking-wider text-muted-foreground">{t("home.or")}</span>
          <Separator className="flex-1" />
        </div>

        <div className="space-y-3">
          <div className="flex items-center gap-2 text-sm font-medium text-foreground">
            <Sparkles className="h-4 w-4 text-muted-foreground" />
            {t("home.enterRoomCode")}
          </div>
          <div className="flex gap-2">
            <Input
              placeholder="ABC123"
              value={roomCode}
              onChange={(event) => {
                setRoomCode(event.target.value.toUpperCase());
                setError("");
              }}
              onKeyDown={(event) => {
                if (event.key === "Enter" && roomCode.trim()) {
                  handleJoinOrCreate(false);
                }
              }}
              maxLength={6}
              className="h-12 rounded-xl border-slate-200/60 bg-white/50 text-center text-base tracking-widest dark:border-slate-700/50 dark:bg-slate-800/50"
            />
            <Button
              onClick={() => handleJoinOrCreate(false)}
              disabled={isConnecting || !roomCode.trim()}
              variant="secondary"
              className="h-12 rounded-xl px-6 font-bold"
            >
              <LogIn className="mr-1 h-5 w-5" />
              {t("home.join")}
            </Button>
          </div>
        </div>

        {error ? (
          <div className="animate-in fade-in slide-in-from-top-1 rounded-xl border border-destructive/20 bg-destructive/10 p-3 text-center text-sm text-destructive">
            {error}
          </div>
        ) : null}
      </div>
    </div>
  );

  return (
    <div className="flex h-screen flex-col overflow-hidden bg-[radial-gradient(circle_at_top_left,rgba(59,130,246,0.12),transparent_28%),radial-gradient(circle_at_bottom_right,rgba(168,85,247,0.14),transparent_30%),linear-gradient(135deg,#f8fafc,#eef2ff,#eff6ff)] dark:bg-[radial-gradient(circle_at_top_left,rgba(59,130,246,0.14),transparent_22%),radial-gradient(circle_at_bottom_right,rgba(168,85,247,0.18),transparent_24%),linear-gradient(135deg,#020617,#0f172a,#111827)]">
      <header className="z-40 shrink-0 border-b border-white/30 bg-white/65 backdrop-blur-xl dark:border-slate-800/70 dark:bg-slate-950/45">
        <div className="flex items-center justify-between gap-3 px-3 py-3 sm:px-4 md:px-6">
          <div className="flex min-w-0 flex-1 items-center gap-2">
            {branding.logoUrl ? (
              <>
                <div className="flex min-w-0 items-center overflow-hidden rounded-[18px] border border-white/60 bg-white/90 px-2 py-1.5 shadow-lg dark:border-slate-800/70 dark:bg-slate-950/75 sm:hidden">
                  <span className="bg-gradient-to-r from-purple-400 to-blue-500 bg-clip-text text-xs font-black uppercase tracking-[0.18em] text-transparent">
                    {branding.siteShortName.toUpperCase()}
                  </span>
                </div>
                <div className="hidden min-w-0 items-center overflow-hidden rounded-[24px] border border-white/60 bg-white/90 px-3 py-2 shadow-lg dark:border-slate-800/70 dark:bg-slate-950/75 sm:flex">
                  <Image
                    src={branding.logoUrl}
                    alt={`${branding.siteName} logo`}
                    width={240}
                    height={72}
                    unoptimized
                    className="h-10 w-auto max-w-[240px] object-contain"
                  />
                </div>
              </>
            ) : (
              <div className="min-w-0 rounded-[22px] border border-white/50 bg-white/80 px-3 py-2 shadow-sm dark:border-slate-800/70 dark:bg-slate-950/70">
                <div className="bg-gradient-to-r from-purple-400 to-blue-500 bg-clip-text text-sm font-black uppercase tracking-[0.18em] text-transparent">
                  {branding.siteShortName.toUpperCase()}
                </div>
              </div>
            )}
          </div>
          <div className="flex shrink-0 items-center gap-1 rounded-full border border-white/60 bg-white/75 px-1.5 py-1 shadow-sm dark:border-slate-800/70 dark:bg-slate-950/70">
            <LanguageSwitcher compact />
            <Button variant="ghost" size="icon" onClick={() => setShowAnnouncements(true)} className="h-8 w-8 rounded-full sm:h-8 sm:w-8">
              <Megaphone className="h-4 w-4" />
            </Button>
            <Button
              variant="ghost"
              size="icon"
              onClick={() => setTheme(resolvedTheme === "dark" ? "light" : "dark")}
              className="h-8 w-8 rounded-full sm:h-8 sm:w-8"
            >
              <span className="relative flex h-4 w-4 items-center justify-center">
                <Sun className="h-4 w-4 rotate-0 scale-100 transition-all dark:-rotate-90 dark:scale-0" />
                <Moon className="absolute h-4 w-4 rotate-90 scale-0 transition-all dark:rotate-0 dark:scale-100" />
              </span>
            </Button>
            {session.user.role === "admin" ? (
              <Button variant="ghost" size="icon" onClick={() => router.push("/admin")} className="h-8 w-8 rounded-full">
                <Settings className="h-4 w-4" />
              </Button>
            ) : null}
            <Separator orientation="vertical" className="mx-0.5 hidden h-5 sm:block" />
            <div className="hidden h-8 w-8 items-center justify-center rounded-full border border-white/70 bg-white/80 text-slate-600 shadow-sm dark:border-slate-700 dark:bg-slate-900 dark:text-slate-300 sm:flex">
              {session.user.image ? (
                <Image
                  src={session.user.image}
                  alt=""
                  width={32}
                  height={32}
                  unoptimized
                  className="h-8 w-8 rounded-full object-cover"
                />
              ) : (
                <UserRound className="h-4 w-4" />
              )}
            </div>
            <Button
              variant="ghost"
              size="icon"
              onClick={() => void signOut({ callbackUrl: "/" })}
              className="h-8 w-8 rounded-full text-muted-foreground hover:text-destructive"
            >
              <LogOut className="h-4 w-4" />
            </Button>
          </div>
        </div>
      </header>

      <div className="flex-1 overflow-hidden p-3 md:p-5">
        <div className="glass-panel h-full w-full overflow-hidden rounded-[28px] shadow-[0_25px_80px_-40px_rgba(15,23,42,0.45)] md:rounded-[34px]">
          <DashboardLayout defaultTab={defaultTab} showPlayTab playContent={playContent} />
        </div>
      </div>

      <AnnouncementsModal isOpen={showAnnouncements} onClose={() => setShowAnnouncements(false)} />
    </div>
  );
}


