"use client";

import Link from "next/link";
import { useSearchParams } from "next/navigation";
import { useSession } from "next-auth/react";
import { useEffect, useRef, useState } from "react";
import {
    BadgeCheck,
    CircleAlert,
    LoaderCircle,
    MailCheck,
} from "lucide-react";
import { useI18n } from "@/components/providers/i18n-provider";

type ViewState = "inbox" | "verifying" | "success" | "error";

export function VerifyEmailClient() {
    const { t } = useI18n();
    const { status: sessionStatus } = useSession();
    const searchParams = useSearchParams();
    const token = searchParams.get("token");
    const sent = searchParams.get("sent") === "1";
    const attemptedToken = useRef<string | null>(null);
    const [state, setState] = useState<ViewState>(
        token ? "verifying" : "inbox"
    );
    const [message, setMessage] = useState(
        sent
            ? t("auth.verifySent")
            : t("auth.verifyInboxHelp")
    );
    const [resending, setResending] = useState(false);

    useEffect(() => {
        if (!token || attemptedToken.current === token) return;
        attemptedToken.current = token;

        const confirm = async () => {
            setState("verifying");
            try {
                const response = await fetch(
                    "/api/auth/email-verification/confirm",
                    {
                        method: "POST",
                        headers: { "content-type": "application/json" },
                        body: JSON.stringify({ token }),
                    }
                );
                const payload = (await response.json().catch(() => null)) as {
                    error?: string;
                } | null;
                if (!response.ok) {
                    setState("error");
                    setMessage(
                        payload?.error ||
                            t("auth.verifyLinkFailed")
                    );
                    return;
                }
                setState("success");
                setMessage(t("auth.verified"));
            } catch {
                setState("error");
                setMessage(
                    t("auth.verificationUnavailable")
                );
            }
        };

        void confirm();
    }, [t, token]);

    const resend = async () => {
        setResending(true);
        try {
            const response = await fetch(
                "/api/auth/email-verification/request",
                { method: "POST" }
            );
            const payload = (await response.json().catch(() => null)) as {
                error?: string;
                message?: string;
            } | null;
            setState(response.ok ? "inbox" : "error");
            setMessage(
                response.ok
                    ? payload?.message ||
                          t("auth.verificationQueued")
                    : payload?.error ||
                          t("auth.verificationResendFailed")
            );
        } catch {
            setState("error");
            setMessage(t("auth.verificationUnavailable"));
        } finally {
            setResending(false);
        }
    };

    const Icon =
        state === "success"
            ? BadgeCheck
            : state === "error"
              ? CircleAlert
              : state === "verifying"
                ? LoaderCircle
                : MailCheck;

    return (
        <main className="relative flex min-h-screen items-center justify-center overflow-hidden bg-[#071b1c] px-4 py-12 text-slate-100">
            <div className="absolute inset-0 bg-[radial-gradient(circle_at_20%_10%,rgba(45,212,191,0.18),transparent_34%),radial-gradient(circle_at_85%_75%,rgba(249,115,22,0.13),transparent_32%)]" />
            <section className="relative w-full max-w-lg rounded-[2rem] border border-white/10 bg-[#0d2929]/90 p-7 shadow-2xl shadow-black/30 backdrop-blur sm:p-10">
                <div
                    className={`mb-6 flex h-16 w-16 items-center justify-center rounded-2xl ${
                        state === "error"
                            ? "bg-rose-500/15 text-rose-300"
                            : "bg-teal-400/15 text-teal-200"
                    }`}
                >
                    <Icon
                        className={`h-8 w-8 ${
                            state === "verifying" ? "animate-spin" : ""
                        }`}
                    />
                </div>
                <div className="text-xs font-black uppercase tracking-[0.24em] text-teal-300">
                    {t("auth.accountSecurity")}
                </div>
                <h1 className="mt-3 font-serif text-3xl font-black tracking-tight sm:text-4xl">
                    {state === "success"
                        ? t("auth.verificationComplete")
                        : state === "error"
                          ? t("auth.linkUnavailable")
                          : state === "verifying"
                            ? t("auth.verifyingEmail")
                            : t("auth.checkInbox")}
                </h1>
                <p className="mt-4 text-sm leading-7 text-slate-300">
                    {message}
                </p>

                <div className="mt-8 flex flex-col gap-3 sm:flex-row">
                    <Link
                        href={
                            sessionStatus === "authenticated"
                                ? "/dashboard"
                                : "/login"
                        }
                        className="inline-flex min-h-11 flex-1 items-center justify-center rounded-xl bg-teal-300 px-5 text-sm font-black text-[#082322] transition hover:bg-teal-200"
                    >
                        {sessionStatus === "authenticated"
                            ? t("auth.goDashboard")
                            : t("auth.goLogin")}
                    </Link>
                    {state === "error" &&
                    sessionStatus === "authenticated" ? (
                        <button
                            type="button"
                            onClick={() => void resend()}
                            disabled={resending}
                            className="inline-flex min-h-11 flex-1 items-center justify-center rounded-xl border border-white/15 px-5 text-sm font-bold text-slate-200 transition hover:bg-white/5 disabled:opacity-50"
                        >
                            {resending
                                ? t("auth.sending")
                                : t("auth.resendLink")}
                        </button>
                    ) : state === "inbox" &&
                      sessionStatus === "authenticated" ? (
                        <button
                            type="button"
                            onClick={() => void resend()}
                            disabled={resending}
                            className="inline-flex min-h-11 flex-1 items-center justify-center rounded-xl border border-white/15 px-5 text-sm font-bold text-slate-200 transition hover:bg-white/5 disabled:opacity-50"
                        >
                            {resending
                                ? t("auth.sending")
                                : t("auth.resend")}
                        </button>
                    ) : null}
                </div>
                <p className="mt-6 text-xs leading-5 text-slate-500">
                    {t("auth.verificationExpiryHelp")}
                </p>
            </section>
        </main>
    );
}
