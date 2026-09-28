"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect } from "react";

export default function HiddenRoomPage() {
    const router = useRouter();
    const roomCode =
        typeof window === "undefined"
            ? ""
            : window.sessionStorage.getItem("tabu_activeRoomCode") || "";
    const hidden =
        typeof window !== "undefined" &&
        roomCode.length > 0 &&
        window.localStorage.getItem(`tabu_room_hide_url:${roomCode}`) === "true";

    useEffect(() => {
        if (roomCode && !hidden) {
            router.replace(`/room/${roomCode}`);
        }
    }, [hidden, roomCode, router]);

    if (!roomCode || !hidden) {
        return (
            <main className="min-h-screen flex items-center justify-center bg-slate-950 px-6">
                <div className="max-w-md rounded-3xl border border-slate-800 bg-slate-900 p-8 text-center shadow-2xl">
                    <h1 className="text-2xl font-black text-white">Aktif oda bulunamadi</h1>
                    <p className="mt-3 text-sm text-slate-400">
                        Gizli oda baglantisi bu cihazda aktif degil.
                    </p>
                    <Link
                        href="/"
                        className="mt-6 inline-flex rounded-xl bg-white px-4 py-2 text-sm font-bold text-slate-950"
                    >
                        Ana sayfaya don
                    </Link>
                </div>
            </main>
        );
    }

    return (
        <main className="min-h-screen flex items-center justify-center bg-slate-950 px-6">
            <div className="max-w-md rounded-3xl border border-slate-800 bg-slate-900 p-8 text-center shadow-2xl">
                <h1 className="text-2xl font-black text-white">Oda baglantisi gizli</h1>
                <p className="mt-3 text-sm text-slate-400">
                    Tarayici adres cubugunda oda kodu saklandi. Odayi yeniden gostermek istersen asagidaki butonu kullan.
                </p>
                <button
                    type="button"
                    onClick={() => {
                        window.localStorage.setItem(`tabu_room_hide_url:${roomCode}`, "false");
                        router.replace(`/room/${roomCode}`);
                    }}
                    className="mt-6 inline-flex rounded-xl bg-white px-4 py-2 text-sm font-bold text-slate-950"
                >
                    Odayi goster
                </button>
            </div>
        </main>
    );
}
