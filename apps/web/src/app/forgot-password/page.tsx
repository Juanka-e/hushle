"use client";

import Link from "next/link";
import { useState } from "react";
import { KeyRound, Mail } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
    getCaptchaTokenForAction,
    prewarmCaptchaForAction,
} from "@/lib/security/captcha-client";
import { useI18n } from "@/components/providers/i18n-provider";

export default function ForgotPasswordPage() {
    const { t } = useI18n();
    const [identifier, setIdentifier] = useState("");
    const [message, setMessage] = useState("");
    const [error, setError] = useState("");
    const [loading, setLoading] = useState(false);

    const submit = async (event: React.FormEvent) => {
        event.preventDefault();
        setLoading(true);
        setError("");
        setMessage("");
        try {
            const { token } =
                await getCaptchaTokenForAction("password_reset");
            const response = await fetch("/api/auth/password-reset/request", {
                method: "POST",
                headers: { "content-type": "application/json" },
                body: JSON.stringify({
                    identifier,
                    captchaToken: token,
                }),
            });
            const payload = (await response.json().catch(() => null)) as {
                error?: string;
                message?: string;
            } | null;
            if (!response.ok) {
                setError(payload?.error || t("auth.requestFailed"));
                return;
            }
            setMessage(
                payload?.message ||
                    t("auth.resetRequestSent")
            );
        } catch {
            setError(t("auth.resetUnavailable"));
        } finally {
            setLoading(false);
        }
    };

    return (
        <main className="relative flex min-h-screen items-center justify-center overflow-hidden bg-[#071b1c] px-4 py-12 text-slate-100">
            <div className="absolute inset-0 bg-[radial-gradient(circle_at_15%_15%,rgba(45,212,191,0.18),transparent_34%),radial-gradient(circle_at_85%_80%,rgba(249,115,22,0.12),transparent_30%)]" />
            <section className="relative w-full max-w-md rounded-[2rem] border border-white/10 bg-[#0d2929]/90 p-7 shadow-2xl shadow-black/30 backdrop-blur sm:p-9">
                <div className="mb-6 flex h-14 w-14 items-center justify-center rounded-2xl bg-teal-400/15 text-teal-200">
                    <KeyRound className="h-7 w-7" />
                </div>
                <div className="text-xs font-black uppercase tracking-[0.24em] text-teal-300">
                    {t("auth.accountSecurity")}
                </div>
                <h1 className="mt-3 text-3xl font-black tracking-tight">
                    {t("auth.resetPassword")}
                </h1>
                <p className="mt-3 text-sm leading-6 text-slate-300">
                    {t("auth.resetRequestHelp")}
                </p>
                <form onSubmit={submit} className="mt-7 space-y-4">
                    <div className="relative">
                        <Mail className="pointer-events-none absolute left-3 top-3 h-5 w-5 text-slate-500" />
                        <Input
                            value={identifier}
                            onChange={(event) =>
                                setIdentifier(event.target.value)
                            }
                            placeholder={t("auth.usernameOrEmail")}
                            autoComplete="username"
                            className="border-white/10 bg-black/20 pl-10 text-white"
                            maxLength={191}
                            required
                        />
                    </div>
                    {message ? (
                        <p className="rounded-xl border border-teal-400/20 bg-teal-400/10 p-3 text-sm text-teal-100">
                            {message}
                        </p>
                    ) : null}
                    {error ? (
                        <p className="rounded-xl border border-rose-400/20 bg-rose-400/10 p-3 text-sm text-rose-100">
                            {error}
                        </p>
                    ) : null}
                    <Button
                        type="submit"
                        disabled={loading}
                        className="w-full bg-teal-300 font-black text-[#082322] hover:bg-teal-200"
                        onFocus={() => prewarmCaptchaForAction("password_reset")}
                        onPointerEnter={() => prewarmCaptchaForAction("password_reset")}
                    >
                        {loading ? t("auth.sending") : t("auth.requestLink")}
                    </Button>
                </form>
                <Link
                    href="/login"
                    className="mt-6 inline-flex text-sm font-bold text-slate-300 hover:text-white"
                >
                    {t("auth.backToLogin")}
                </Link>
            </section>
        </main>
    );
}
