import { Suspense } from "react";
import { ResetPasswordClient } from "./reset-password-client";
import { cookies } from "next/headers";
import { LOCALE_COOKIE_NAME, normalizeAppLocale } from "@/lib/i18n/config";
import { translate } from "@/lib/i18n/dictionaries";

export default async function ResetPasswordPage() {
    const cookieStore = await cookies();
    const locale = normalizeAppLocale(cookieStore.get(LOCALE_COOKIE_NAME)?.value);
    return (
        <Suspense
            fallback={
                <div className="flex min-h-screen items-center justify-center bg-slate-950 text-slate-300">
                    {translate(locale, "auth.preparingPassword")}
                </div>
            }
        >
            <ResetPasswordClient />
        </Suspense>
    );
}
