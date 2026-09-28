"use client";

import Link from "next/link";
import { useMemo, useState } from "react";
import { useSearchParams } from "next/navigation";
import { BadgeCheck, KeyRound } from "lucide-react";
import {
    evaluatePasswordPolicy,
    PASSWORD_MIN_LENGTH,
} from "@hushle/auth-policy";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { useI18n } from "@/components/providers/i18n-provider";

export function ResetPasswordClient() {
    const { t } = useI18n();
    const token = useSearchParams().get("token") ?? "";
    const [password, setPassword] = useState("");
    const [confirmation, setConfirmation] = useState("");
    const [message, setMessage] = useState("");
    const [error, setError] = useState("");
    const [loading, setLoading] = useState(false);
    const [completed, setCompleted] = useState(false);
    const policy = useMemo(
        () => evaluatePasswordPolicy(password),
        [password]
    );
    const matches = password.length > 0 && password === confirmation;

    const submit = async (event: React.FormEvent) => {
        event.preventDefault();
        if (!policy.accepted || !matches || !token) return;
        setLoading(true);
        setError("");
        try {
            const response = await fetch("/api/auth/password-reset/confirm", {
                method: "POST",
                headers: { "content-type": "application/json" },
                body: JSON.stringify({ token, password }),
            });
            const payload = (await response.json().catch(() => null)) as {
                error?: string;
            } | null;
            if (!response.ok) {
                setError(payload?.error || t("auth.resetFailed"));
                return;
            }
            setCompleted(true);
            setMessage(
                t("auth.passwordChanged")
            );
        } catch {
            setError(t("auth.resetUnavailable"));
        } finally {
            setLoading(false);
        }
    };

    return (
        <main className="relative flex min-h-screen items-center justify-center overflow-hidden bg-[#071b1c] px-4 py-12 text-slate-100">
            <div className="absolute inset-0 bg-[radial-gradient(circle_at_18%_10%,rgba(45,212,191,0.18),transparent_34%),radial-gradient(circle_at_82%_82%,rgba(249,115,22,0.12),transparent_30%)]" />
            <section className="relative w-full max-w-md rounded-[2rem] border border-white/10 bg-[#0d2929]/90 p-7 shadow-2xl shadow-black/30 backdrop-blur sm:p-9">
                <div className="mb-6 flex h-14 w-14 items-center justify-center rounded-2xl bg-teal-400/15 text-teal-200">
                    {completed ? (
                        <BadgeCheck className="h-7 w-7" />
                    ) : (
                        <KeyRound className="h-7 w-7" />
                    )}
                </div>
                <h1 className="text-3xl font-black tracking-tight">
                    {completed ? t("auth.passwordRenewed") : t("auth.choosePassword")}
                </h1>
                {completed ? (
                    <>
                        <p className="mt-4 text-sm leading-6 text-slate-300">
                            {message}
                        </p>
                        <Link
                            href="/login"
                            className="mt-7 inline-flex min-h-11 w-full items-center justify-center rounded-xl bg-teal-300 px-5 text-sm font-black text-[#082322] hover:bg-teal-200"
                        >
                            {t("auth.loginAgain")}
                        </Link>
                    </>
                ) : (
                    <form onSubmit={submit} className="mt-7 space-y-4">
                        <Input
                            type="password"
                            value={password}
                            onChange={(event) =>
                                setPassword(event.target.value)
                            }
                            placeholder={t("auth.newPassword")}
                            autoComplete="new-password"
                            className="border-white/10 bg-black/20 text-white"
                            required
                        />
                        <Input
                            type="password"
                            value={confirmation}
                            onChange={(event) =>
                                setConfirmation(event.target.value)
                            }
                            placeholder={t("auth.repeatPassword")}
                            autoComplete="new-password"
                            className="border-white/10 bg-black/20 text-white"
                            required
                        />
                        <div className="grid grid-cols-4 gap-2">
                            {[1, 2, 3, 4].map((bar) => (
                                <span
                                    key={bar}
                                    className={`h-1.5 rounded-full ${
                                        password && bar <= Math.max(1, policy.score)
                                            ? policy.accepted
                                                ? "bg-emerald-400"
                                                : "bg-amber-400"
                                            : "bg-white/10"
                                    }`}
                                />
                            ))}
                        </div>
                        <p className="text-xs leading-5 text-slate-400">
                            {password
                                ? policy.accepted
                                    ? t("auth.strongPassword")
                                    : t("auth.strengthenPassword")
                                : t("auth.minPassword", { count: PASSWORD_MIN_LENGTH })}
                            {confirmation && !matches
                                ? ` ${t("auth.passwordsMismatch")}`
                                : ""}
                        </p>
                        {!token ? (
                            <p className="rounded-xl border border-rose-400/20 bg-rose-400/10 p-3 text-sm text-rose-100">
                                {t("auth.invalidResetLink")}
                            </p>
                        ) : null}
                        {error ? (
                            <p className="rounded-xl border border-rose-400/20 bg-rose-400/10 p-3 text-sm text-rose-100">
                                {error}
                            </p>
                        ) : null}
                        <Button
                            type="submit"
                            disabled={
                                loading ||
                                !token ||
                                !policy.accepted ||
                                !matches
                            }
                            className="w-full bg-teal-300 font-black text-[#082322] hover:bg-teal-200"
                        >
                            {loading ? t("auth.changing") : t("auth.changePassword")}
                        </Button>
                    </form>
                )}
            </section>
        </main>
    );
}
