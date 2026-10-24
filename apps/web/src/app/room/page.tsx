"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useSyncExternalStore } from "react";
import { useI18n } from "@/components/providers/i18n-provider";

const subscribeToNothing = () => () => undefined;

/**
 * Reads browser storage without a hydration mismatch: the server and the first client
 * render both see "", and React re-renders with the stored value right after.
 */
function useStoredValue(read: () => string | null): string {
    return useSyncExternalStore(
        subscribeToNothing,
        () => {
            try {
                return read() ?? "";
            } catch {
                return "";
            }
        },
        () => ""
    );
}

export default function HiddenRoomPage() {
    const router = useRouter();
    const { t } = useI18n();
    const roomCode = useStoredValue(() => window.sessionStorage.getItem("tabu_activeRoomCode"));
    const hideUrl = useStoredValue(() =>
        roomCode ? window.localStorage.getItem(`tabu_room_hide_url:${roomCode}`) : null
    );
    const hidden = roomCode.length > 0 && hideUrl === "true";

    useEffect(() => {
        if (roomCode && !hidden) {
            router.replace(`/room/${roomCode}`);
        }
    }, [hidden, roomCode, router]);

    if (!roomCode || !hidden) {
        return (
            <main className="min-h-screen flex items-center justify-center bg-slate-950 px-6">
                <div className="max-w-md rounded-3xl border border-slate-800 bg-slate-900 p-8 text-center shadow-2xl">
                    <h1 className="text-2xl font-black text-white">{t("room.noActiveRoomTitle")}</h1>
                    <p className="mt-3 text-sm text-slate-400">{t("room.noActiveRoomBody")}</p>
                    <Link
                        href="/"
                        className="mt-6 inline-flex rounded-xl bg-white px-4 py-2 text-sm font-bold text-slate-950"
                    >
                        {t("room.backToHome")}
                    </Link>
                </div>
            </main>
        );
    }

    return (
        <main className="min-h-screen flex items-center justify-center bg-slate-950 px-6">
            <div className="max-w-md rounded-3xl border border-slate-800 bg-slate-900 p-8 text-center shadow-2xl">
                <h1 className="text-2xl font-black text-white">{t("room.hiddenRoomTitle")}</h1>
                <p className="mt-3 text-sm text-slate-400">{t("room.hiddenRoomBody")}</p>
                <button
                    type="button"
                    onClick={() => {
                        window.localStorage.setItem(`tabu_room_hide_url:${roomCode}`, "false");
                        router.replace(`/room/${roomCode}`);
                    }}
                    className="mt-6 inline-flex rounded-xl bg-white px-4 py-2 text-sm font-bold text-slate-950"
                >
                    {t("room.showRoom")}
                </button>
            </div>
        </main>
    );
}
