"use client";

import Link from "next/link";
import { useEffect, useRef, useState } from "react";
import { useSearchParams } from "next/navigation";
import { BadgeCheck, CircleAlert, LoaderCircle } from "lucide-react";

type State = "verifying" | "success" | "error";

export function VerifyEmailChangeClient() {
    const token = useSearchParams().get("token") ?? "";
    const attempted = useRef(false);
    const [state, setState] = useState<State>(
        token ? "verifying" : "error"
    );
    const [message, setMessage] = useState(
        token ? "Yeni adres doğrulanıyor..." : "Doğrulama bağlantısı eksik."
    );

    useEffect(() => {
        if (attempted.current) return;
        attempted.current = true;
        if (!token) return;
        void fetch("/api/auth/email-change/confirm", {
            method: "POST",
            headers: { "content-type": "application/json" },
            body: JSON.stringify({ token }),
        })
            .then(async (response) => {
                const payload = (await response.json().catch(() => null)) as {
                    error?: string;
                } | null;
                if (!response.ok) {
                    throw new Error(
                        payload?.error || "Bağlantı kullanılamadı."
                    );
                }
                setState("success");
                setMessage(
                    "E-posta adresin değiştirildi. Güvenlik için açık oturumların kapatıldı."
                );
            })
            .catch((error: unknown) => {
                setState("error");
                setMessage(
                    error instanceof Error
                        ? error.message
                        : "Bağlantı kullanılamadı."
                );
            });
    }, [token]);

    const Icon =
        state === "success"
            ? BadgeCheck
            : state === "error"
              ? CircleAlert
              : LoaderCircle;
    return (
        <main className="relative flex min-h-screen items-center justify-center overflow-hidden bg-[#071b1c] px-4 py-12 text-slate-100">
            <section className="relative w-full max-w-lg rounded-[2rem] border border-white/10 bg-[#0d2929]/95 p-8 shadow-2xl">
                <Icon
                    className={`h-12 w-12 text-teal-200 ${
                        state === "verifying" ? "animate-spin" : ""
                    }`}
                />
                <h1 className="mt-6 text-3xl font-black">
                    {state === "success"
                        ? "E-posta değiştirildi"
                        : state === "error"
                          ? "Bağlantı kullanılamadı"
                          : "Adres doğrulanıyor"}
                </h1>
                <p className="mt-4 text-sm leading-7 text-slate-300">
                    {message}
                </p>
                <Link
                    href="/login"
                    className="mt-8 inline-flex min-h-11 items-center justify-center rounded-xl bg-teal-300 px-6 text-sm font-black text-[#082322] hover:bg-teal-200"
                >
                    Giriş ekranına git
                </Link>
            </section>
        </main>
    );
}
