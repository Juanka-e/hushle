import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { Suspense } from "react";
import { CheckoutContent } from "@/components/payments/checkout-content";
import { getSessionUser } from "@/lib/session";

export const metadata: Metadata = {
    title: "Güvenli Ödeme | Hushle",
    description: "Hushle dijital ürün ödeme ve sipariş durumu.",
    robots: { index: false, follow: false },
};

export default async function CheckoutPage() {
    const user = await getSessionUser();
    if (!user) redirect("/login?callbackUrl=/checkout");

    return (
        <Suspense fallback={<div className="min-h-screen bg-slate-50 dark:bg-slate-950" />}>
            <CheckoutContent />
        </Suspense>
    );
}
