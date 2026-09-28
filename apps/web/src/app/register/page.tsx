"use client";

import Image from "next/image";
import Link from "next/link";
import { useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import {
    CheckCircle2,
    Eye,
    EyeOff,
    ShieldCheck,
    UserPlus,
} from "lucide-react";
import {
    evaluatePasswordPolicy,
    PASSWORD_MIN_LENGTH,
} from "@hushle/auth-policy";
import { toast } from "sonner";
import { useBranding } from "@/components/providers/branding-provider";
import { useI18n } from "@/components/providers/i18n-provider";
import { LanguageSwitcher } from "@/components/i18n/language-switcher";
import { Button } from "@/components/ui/button";
import {
    Card,
    CardContent,
    CardDescription,
    CardFooter,
    CardHeader,
    CardTitle,
} from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import {
    getCaptchaTokenForAction,
    prewarmCaptchaForAction,
} from "@/lib/security/captcha-client";

export default function RegisterPage() {
    const [username, setUsername] = useState("");
    const [email, setEmail] = useState("");
    const [password, setPassword] = useState("");
    const [showPassword, setShowPassword] = useState(false);
    const [error, setError] = useState("");
    const [loading, setLoading] = useState(false);
    const router = useRouter();
    const branding = useBranding();
    const { locale, t } = useI18n();
    const passwordPolicy = useMemo(
        () =>
            evaluatePasswordPolicy(password, {
                username,
                email,
                siteName: branding.siteName,
            }),
        [branding.siteName, email, password, username]
    );
    const activeStrengthBars = password
        ? Math.max(1, passwordPolicy.score)
        : 0;
    const strengthLabel = passwordPolicy.accepted
        ? t("auth.strongPassword")
        : password
          ? (locale === "tr" ? passwordPolicy.issues[0] : null) ?? t("auth.strengthenPassword")
          : t("auth.minPassword", { count: PASSWORD_MIN_LENGTH });

    const handleRegister = async (e: React.FormEvent) => {
        e.preventDefault();
        setLoading(true);
        setError("");

        try {
            const { token } = await getCaptchaTokenForAction("register");
            const res = await fetch("/api/auth/register", {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({
                    username,
                    email,
                    password,
                    captchaToken: token,
                }),
            });

            const data = (await res.json()) as {
                error?: string;
                verificationRequired?: boolean;
            };

            if (!res.ok) {
                setError(data.error || t("auth.registerFailed"));
            } else {
                if (data.verificationRequired) {
                    toast.success(
                        t("auth.verificationSent")
                    );
                    router.push("/verify-email?sent=1&required=1");
                } else {
                    toast.success(t("auth.registrationComplete"));
                    router.push("/login");
                }
            }
        } catch {
            setError(t("auth.genericError"));
        } finally {
            setLoading(false);
        }
    };

    return (
        <div className="flex min-h-screen items-center justify-center bg-gray-50 p-4 dark:bg-slate-900 [@media(max-height:500px)]:items-start [@media(max-height:500px)]:p-2">
            <div className="fixed right-4 top-4"><LanguageSwitcher /></div>
            <Card className="w-full max-w-sm shadow-xl">
                <CardHeader className="space-y-4 [@media(max-height:500px)]:py-3">
                    <div className="flex flex-col items-center gap-3 text-center">
                        {branding.logoUrl ? (
                            <div className="flex w-full max-w-[260px] items-center justify-center rounded-2xl border border-border/70 bg-background/90 px-3 py-2 [@media(max-height:500px)]:hidden">
                                <Image
                                    src={branding.logoUrl}
                                    alt={`${branding.siteName} logo`}
                                    width={260}
                                    height={78}
                                    className="h-14 w-auto max-w-full object-contain sm:h-16"
                                    unoptimized
                                />
                            </div>
                        ) : (
                            <div className="flex h-14 w-14 items-center justify-center rounded-2xl bg-primary/10 text-primary [@media(max-height:500px)]:hidden">
                                <UserPlus className="h-6 w-6" />
                            </div>
                        )}
                        <div className="space-y-1">
                            <CardTitle className="flex items-center justify-center gap-2 text-2xl font-bold">
                                <UserPlus className="h-5 w-5 text-primary" />
                                {t("auth.registerTitle")}
                            </CardTitle>
                            {!branding.logoUrl ? (
                                <CardDescription>{t("auth.registerDescription")}</CardDescription>
                            ) : null}
                        </div>
                    </div>
                </CardHeader>
                <CardContent className="[@media(max-height:500px)]:pb-3">
                    <form
                        onSubmit={handleRegister}
                        className="space-y-4 [@media(max-height:500px)]:space-y-2"
                    >
                        <Input
                            type="text"
                            placeholder={t("auth.username")}
                            value={username}
                            onChange={(e) => setUsername(e.target.value)}
                            required
                            minLength={3}
                            maxLength={50}
                            autoComplete="username"
                        />
                        <Input
                            type="email"
                            placeholder={t("auth.email")}
                            value={email}
                            onChange={(e) => setEmail(e.target.value)}
                            required
                            maxLength={191}
                            autoComplete="email"
                        />
                        <div className="space-y-2">
                            <div className="relative">
                                <Input
                                    type={showPassword ? "text" : "password"}
                                    placeholder={t("auth.password")}
                                    value={password}
                                    onChange={(e) => setPassword(e.target.value)}
                                    required
                                    minLength={PASSWORD_MIN_LENGTH}
                                    maxLength={256}
                                    autoComplete="new-password"
                                    aria-describedby="password-strength"
                                    className="pr-11"
                                />
                                <button
                                    type="button"
                                    onClick={() => setShowPassword((value) => !value)}
                                    className="absolute inset-y-0 right-0 flex w-11 items-center justify-center text-muted-foreground transition-colors hover:text-foreground"
                                    aria-label={
                                        showPassword
                                            ? t("auth.hidePassword")
                                            : t("auth.showPassword")
                                    }
                                >
                                    {showPassword ? (
                                        <EyeOff className="h-4 w-4" />
                                    ) : (
                                        <Eye className="h-4 w-4" />
                                    )}
                                </button>
                            </div>
                            <div
                                id="password-strength"
                                className="space-y-2 rounded-xl border border-border/70 bg-muted/35 p-3 [@media(max-height:500px)]:space-y-1.5 [@media(max-height:500px)]:p-2"
                                aria-live="polite"
                            >
                                <div className="flex gap-1.5" aria-hidden="true">
                                    {[1, 2, 3, 4].map((bar) => (
                                        <span
                                            key={bar}
                                            className={`h-1.5 flex-1 rounded-full transition-colors ${
                                                bar <= activeStrengthBars
                                                    ? passwordPolicy.accepted
                                                        ? "bg-emerald-500"
                                                        : passwordPolicy.score >= 2
                                                          ? "bg-amber-500"
                                                          : "bg-red-500"
                                                    : "bg-border"
                                            }`}
                                        />
                                    ))}
                                </div>
                                <div
                                    className={`flex items-start gap-2 text-xs ${
                                        passwordPolicy.accepted
                                            ? "text-emerald-700 dark:text-emerald-400"
                                            : "text-muted-foreground"
                                    }`}
                                >
                                    {passwordPolicy.accepted ? (
                                        <CheckCircle2 className="mt-0.5 h-3.5 w-3.5 shrink-0" />
                                    ) : (
                                        <ShieldCheck className="mt-0.5 h-3.5 w-3.5 shrink-0" />
                                    )}
                                    <span>{strengthLabel}</span>
                                </div>
                            </div>
                        </div>
                        {error ? (
                            <div className="text-sm font-medium text-red-500">{error}</div>
                        ) : null}
                        <Button
                            type="submit"
                            className="w-full"
                            disabled={loading || !passwordPolicy.accepted}
                            onFocus={() => prewarmCaptchaForAction("register")}
                            onPointerEnter={() => prewarmCaptchaForAction("register")}
                        >
                            {loading ? t("auth.registering") : t("auth.registerTitle")}
                        </Button>
                    </form>
                </CardContent>
                <CardFooter className="flex justify-center [@media(max-height:500px)]:hidden">
                    <p className="text-sm text-muted-foreground">
                        {t("auth.hasAccount")} {" "}
                        <Link href="/login" className="text-primary hover:underline">
                            {t("auth.loginTitle")}
                        </Link>
                    </p>
                </CardFooter>
            </Card>
        </div>
    );
}
