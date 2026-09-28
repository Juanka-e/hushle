"use client";

import { useState } from "react";
import { signIn } from "next-auth/react";
import { useRouter } from "next/navigation";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Label } from "@/components/ui/label";
import { Shield, Loader2 } from "lucide-react";
import {
    getCaptchaTokenForAction,
    prewarmCaptchaForAction,
} from "@/lib/security/captcha-client";
import { resolveSafeCallbackUrl } from "@/lib/security/safe-callback-url";

export default function AdminLoginPage() {
    const [username, setUsername] = useState("");
    const [password, setPassword] = useState("");
    const [error, setError] = useState("");
    const [loading, setLoading] = useState(false);
    const router = useRouter();

    const handleLogin = async (e: React.FormEvent) => {
        e.preventDefault();
        setLoading(true);
        setError("");

        try {
            const { token } = await getCaptchaTokenForAction("login");
            const result = await signIn("credentials", {
                username,
                password,
                portal: "admin",
                captchaToken: token,
                captchaAction: "login",
                redirect: false,
            });

            if (result?.error) {
                setError("Kullanici adi veya sifre hatali.");
                setLoading(false);
                return;
            }

            const callbackUrl =
                typeof window !== "undefined"
                    ? resolveSafeCallbackUrl(
                          new URLSearchParams(window.location.search).get("callbackUrl"),
                          "/admin"
                      )
                    : "/admin";
            router.push(callbackUrl);
            router.refresh();
        } catch {
            setError("Guvenlik dogrulamasi baslatilamadi.");
        } finally {
            setLoading(false);
        }
    };

    return (
        <div className="min-h-screen bg-gradient-to-br from-background to-muted flex items-center justify-center p-4">
            <Card className="w-full max-w-sm border-border/50 bg-card/80 backdrop-blur-xl shadow-2xl">
                <CardHeader className="text-center space-y-3">
                    <div className="mx-auto w-12 h-12 bg-primary/10 rounded-xl flex items-center justify-center">
                        <Shield className="h-6 w-6 text-primary" />
                    </div>
                    <CardTitle className="text-xl">Admin Girisi</CardTitle>
                </CardHeader>
                <CardContent>
                    <form onSubmit={handleLogin} className="space-y-4">
                        <div className="space-y-2">
                            <Label htmlFor="username">Kullanici Adi</Label>
                            <Input id="username" value={username} onChange={(e) => setUsername(e.target.value)} required autoFocus />
                        </div>
                        <div className="space-y-2">
                            <Label htmlFor="password">Sifre</Label>
                            <Input id="password" type="password" value={password} onChange={(e) => setPassword(e.target.value)} required />
                        </div>
                        {error && <p className="text-sm text-destructive text-center">{error}</p>}
                        <Button
                            type="submit"
                            className="w-full"
                            disabled={loading}
                            onFocus={() => prewarmCaptchaForAction("login")}
                            onPointerEnter={() => prewarmCaptchaForAction("login")}
                        >
                            {loading ? <Loader2 className="h-4 w-4 animate-spin" /> : "Giris Yap"}
                        </Button>
                    </form>
                </CardContent>
            </Card>
        </div>
    );
}
