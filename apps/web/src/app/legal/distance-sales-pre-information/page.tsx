import { cookies } from "next/headers";
import { LegalDocumentPage, LegalSection } from "@/components/payments/legal-document-page";
import { LOCALE_COOKIE_NAME, normalizeAppLocale } from "@/lib/i18n/config";
import { getPaymentLegalReadiness } from "@/lib/payments/legal";

export const metadata = { robots: { index: false, follow: false } };

export default async function DistanceSalesPreInformationPage() {
    const legal = getPaymentLegalReadiness();
    const locale = normalizeAppLocale((await cookies()).get(LOCALE_COOKIE_NAME)?.value);
    const en = locale === "en";
    return (
        <LegalDocumentPage locale={locale} eyebrow={en ? "Before ordering" : "Sipariş öncesi"} title={en ? "Distance Sales Pre-Contract Information" : "Mesafeli Satış Ön Bilgilendirme"} version={legal.distanceSalesNoticeVersion} ready={legal.ready}>
            <LegalSection title={en ? "Seller information" : "Satıcı bilgileri"}>
                <p>{en ? "Name" : "Unvan"}: {legal.businessName ?? (en ? "[Business name]" : "[İşletme unvanı]")}</p>
                <p>{en ? "Address" : "Adres"}: {legal.businessAddress ?? (en ? "[Full business address]" : "[Açık işletme adresi]")}</p>
                <p>{en ? "Email" : "E-posta"}: {legal.contactEmail ?? (en ? "[Contact email address]" : "[İletişim e-posta adresi]")}</p>
            </LegalSection>
            <LegalSection title={en ? "Product and total price" : "Ürün ve toplam bedel"}>
                <p>{en ? "The product's essential characteristics, quantity, total price, currency, and applicable taxes are shown in the checkout summary immediately before the order is placed. The user confirms the payment obligation through an explicit button." : "Ürünün temel nitelikleri, adet, toplam bedel, para birimi ve varsa vergiler checkout özetinde sipariş verilmeden hemen önce gösterilir. Kullanıcı, ödeme yükümlülüğü doğuran işlemi açık bir butonla onaylar."}</p>
            </LegalSection>
            <LegalSection title={en ? "Delivery and performance" : "Teslim ve ifa"}>
                <p>{en ? "The digital product is delivered electronically to the selected user account after payment verification. Estimated delivery and order status can be monitored on the checkout screen." : "Dijital ürün, ödeme doğrulandıktan sonra seçilen kullanıcı hesabına elektronik ortamda teslim edilir. Tahmini teslim ve sipariş durumu checkout ekranından izlenir."}</p>
            </LegalSection>
            <LegalSection title={en ? "Withdrawal, refund, and disputes" : "Cayma, iade ve uyuşmazlık"}>
                <p>{en ? "The right of withdrawal for digital content is determined according to the specific order conditions, including when performance begins and statutory exceptions. Payments cannot be enabled until legal counsel approves the final text for the business and product model." : "Dijital içerik bakımından cayma hakkının kullanımı, ifaya ne zaman başlandığı ve mevzuattaki istisnalar dahil somut sipariş koşullarına göre belirlenir. Nihai metin hukuk danışmanı tarafından işletme ve ürün modeline göre onaylanmadan ödeme açılamaz."}</p>
            </LegalSection>
        </LegalDocumentPage>
    );
}
