import { Suspense } from "react";
import { VerifyEmailChangeClient } from "./verify-email-change-client";

export default function VerifyEmailChangePage() {
    return (
        <Suspense
            fallback={
                <div className="flex min-h-screen items-center justify-center bg-slate-950 text-slate-300">
                    Doğrulama hazırlanıyor...
                </div>
            }
        >
            <VerifyEmailChangeClient />
        </Suspense>
    );
}
