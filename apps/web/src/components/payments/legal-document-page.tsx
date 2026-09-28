import Link from "next/link";
import { AlertTriangle, ArrowLeft, ShieldCheck } from "lucide-react";
import type { AppLocale } from "@/lib/i18n/config";
import { translate } from "@/lib/i18n/dictionaries";

interface LegalDocumentPageProps {
    eyebrow: string;
    title: string;
    version: string;
    ready: boolean;
    locale: AppLocale;
    children: React.ReactNode;
}

export function LegalDocumentPage({
    eyebrow,
    title,
    version,
    ready,
    locale,
    children,
}: LegalDocumentPageProps) {
    return (
        <main className="min-h-screen bg-[radial-gradient(circle_at_top_left,#dbeafe_0,transparent_34%),linear-gradient(160deg,#f8fafc_0%,#eef2f7_100%)] px-4 py-8 text-slate-900 dark:bg-[radial-gradient(circle_at_top_left,#172554_0,transparent_35%),linear-gradient(160deg,#020617_0%,#111827_100%)] dark:text-slate-100 md:px-8 md:py-12">
            <article className="mx-auto max-w-3xl overflow-hidden rounded-[30px] border border-white/70 bg-white/90 shadow-[0_28px_90px_-54px_rgba(15,23,42,0.55)] backdrop-blur dark:border-slate-800 dark:bg-slate-950/85">
                <header className="border-b border-slate-200/80 px-6 py-6 dark:border-slate-800 md:px-10 md:py-8">
                    <Link href="/checkout" className="inline-flex items-center gap-2 text-sm font-bold text-slate-500 hover:text-slate-900 dark:text-slate-400 dark:hover:text-white">
                        <ArrowLeft className="h-4 w-4" /> {translate(locale, "checkout.backPayment")}
                    </Link>
                    <div className="mt-6 flex items-center gap-2 text-xs font-black uppercase tracking-[0.18em] text-blue-700 dark:text-blue-300">
                        <ShieldCheck className="h-4 w-4" /> {eyebrow}
                    </div>
                    <h1 className="mt-3 text-3xl font-black tracking-tight md:text-4xl">{title}</h1>
                    <p className="mt-3 text-sm text-slate-500 dark:text-slate-400">{translate(locale, "checkout.documentVersion", { version })}</p>
                </header>
                {!ready ? (
                    <div className="mx-6 mt-6 flex gap-3 rounded-2xl border border-amber-300 bg-amber-50 p-4 text-sm leading-6 text-amber-900 dark:border-amber-900/60 dark:bg-amber-950/35 dark:text-amber-200 md:mx-10">
                        <AlertTriangle className="mt-0.5 h-5 w-5 shrink-0" />
                        <p>{translate(locale, "checkout.legalUnavailable")}</p>
                    </div>
                ) : null}
                <div className="space-y-7 px-6 py-8 text-sm leading-7 text-slate-700 dark:text-slate-300 md:px-10 md:py-10">
                    {children}
                </div>
            </article>
        </main>
    );
}

export function LegalSection({ title, children }: { title: string; children: React.ReactNode }) {
    return (
        <section>
            <h2 className="text-lg font-black text-slate-950 dark:text-white">{title}</h2>
            <div className="mt-2 space-y-2">{children}</div>
        </section>
    );
}
