import { Suspense } from "react";
import { VerifyEmailClient } from "./verify-email-client";
import { cookies } from "next/headers";
import { LOCALE_COOKIE_NAME, normalizeAppLocale } from "@/lib/i18n/config";
import { translate } from "@/lib/i18n/dictionaries";

export default async function VerifyEmailPage() {
    const cookieStore = await cookies();
    const locale = normalizeAppLocale(cookieStore.get(LOCALE_COOKIE_NAME)?.value);
    return (
        <Suspense
            fallback={
                <div className="flex min-h-screen items-center justify-center bg-slate-950 text-sm font-semibold text-slate-300">
                    {translate(locale, "auth.preparingVerification")}
                </div>
            }
        >
            <VerifyEmailClient />
        </Suspense>
    );
}
