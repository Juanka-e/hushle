"use client";

import Image from "next/image";
import Link from "next/link";
import { useEffect, useState } from "react";
import { signIn } from "next-auth/react";
import { useRouter } from "next/navigation";
import { LogIn } from "lucide-react";
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
import { resolveSafeCallbackUrl } from "@/lib/security/safe-callback-url";

export default function LoginPage() {
    const [username, setUsername] = useState("");
    const [password, setPassword] = useState("");
    const [error, setError] = useState("");
    const [loading, setLoading] = useState(false);
    const [googleEnabled, setGoogleEnabled] = useState(false);
    const router = useRouter();
    const branding = useBranding();
    const { t } = useI18n();

    useEffect(() => {
        const authError = new URLSearchParams(window.location.search).get("error");
        if (authError === "OAuthAccountNotLinked") {
            setError(
                t("auth.oauthLinked")
            );
        } else if (authError) {
            setError(t("auth.oauthFailed"));
        }

        void fetch("/api/auth/providers", { cache: "no-store" })
            .then((response) => (response.ok ? response.json() : null))
            .then((providers: Record<string, unknown> | null) =>
                setGoogleEnabled(Boolean(providers?.google))
            )
            .catch(() => setGoogleEnabled(false));
    }, [t]);

    const getCallbackUrl = () =>
        resolveSafeCallbackUrl(
            new URLSearchParams(window.location.search).get("callbackUrl"),
            "/dashboard"
        );

    const handleLogin = async (event: React.FormEvent) => {
        event.preventDefault();
        setLoading(true);
        setError("");
        const callbackUrl = getCallbackUrl();

        try {
            const { token } = await getCaptchaTokenForAction("login");
            const response = await signIn("credentials", {
                username,
                password,
                portal: "user",
                captchaToken: token,
                captchaAction: "login",
                redirect: false,
            });

            if (response?.error) {
                setError(t("auth.loginFailed"));
            } else {
                const verificationResponse = await fetch(
                    "/api/auth/email-verification/status",
                    { cache: "no-store" }
                ).catch(() => null);
                const verification = verificationResponse?.ok
                    ? ((await verificationResponse.json()) as {
                          restricted?: boolean;
                      })
                    : null;
                router.push(
                    verification?.restricted
                        ? "/verify-email?required=1"
                        : callbackUrl
                );
                router.refresh();
            }
        } catch {
            setError(t("auth.genericError"));
        } finally {
            setLoading(false);
        }
    };

    return (
        <div className="flex min-h-screen items-center justify-center bg-gray-50 p-4 dark:bg-slate-900">
            <div className="fixed right-4 top-4"><LanguageSwitcher /></div>
            <Card className="w-full max-w-sm shadow-xl">
                <CardHeader className="space-y-4">
                    <div className="flex flex-col items-center gap-3 text-center">
                        {branding.logoUrl ? (
                            <div className="flex w-full max-w-[260px] items-center justify-center rounded-2xl border border-border/70 bg-background/90 px-3 py-2">
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
                            <div className="flex h-14 w-14 items-center justify-center rounded-2xl bg-primary/10 text-primary">
                                <LogIn className="h-6 w-6" />
                            </div>
                        )}
                        <div className="space-y-1">
                            <CardTitle className="flex items-center justify-center gap-2 text-2xl font-bold">
                                <LogIn className="h-5 w-5 text-primary" />
                                {t("auth.loginTitle")}
                            </CardTitle>
                            {!branding.logoUrl ? (
                                <CardDescription>{t("auth.loginDescription")}</CardDescription>
                            ) : null}
                        </div>
                    </div>
                </CardHeader>
                <CardContent>
                    <form onSubmit={handleLogin} className="space-y-4">
                        <Input
                            type="text"
                            placeholder={t("auth.username")}
                            value={username}
                            onChange={(event) => setUsername(event.target.value)}
                            required
                        />
                        <Input
                            type="password"
                            placeholder={t("auth.password")}
                            value={password}
                            onChange={(event) => setPassword(event.target.value)}
                            required
                        />
                        <div className="text-right">
                            <Link
                                href="/forgot-password"
                                className="text-xs font-bold text-primary hover:underline"
                            >
                                {t("auth.forgotPassword")}
                            </Link>
                        </div>
                        {error ? (
                            <div className="text-sm font-medium text-red-500">{error}</div>
                        ) : null}
                        <Button
                            type="submit"
                            className="w-full"
                            disabled={loading}
                            onFocus={() => prewarmCaptchaForAction("login")}
                            onPointerEnter={() => prewarmCaptchaForAction("login")}
                        >
                            {loading ? t("auth.loggingIn") : t("auth.loginTitle")}
                        </Button>
                    </form>
                    {googleEnabled ? (
                        <div className="mt-5 space-y-4">
                            <div className="flex items-center gap-3 text-xs font-bold uppercase tracking-[0.16em] text-muted-foreground">
                                <span className="h-px flex-1 bg-border" />
                                {t("auth.or")}
                                <span className="h-px flex-1 bg-border" />
                            </div>
                            <Button
                                type="button"
                                variant="outline"
                                className="w-full"
                                disabled={loading}
                                onClick={() =>
                                    void signIn("google", {
                                        callbackUrl: getCallbackUrl(),
                                    })
                                }
                            >
                                <span className="text-base font-black">G</span>
                                {t("auth.continueGoogle")}
                            </Button>
                        </div>
                    ) : null}
                </CardContent>
                <CardFooter className="flex justify-center">
                    <p className="text-sm text-muted-foreground">
                        {t("auth.noAccount")} {" "}
                        <Link href="/register" className="text-primary hover:underline">
                            {t("auth.registerTitle")}
                        </Link>
                    </p>
                </CardFooter>
            </Card>
        </div>
    );
}
