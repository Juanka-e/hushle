import { cookies } from "next/headers";
import { LegalDocumentPage, LegalSection } from "@/components/payments/legal-document-page";
import { LOCALE_COOKIE_NAME, normalizeAppLocale } from "@/lib/i18n/config";
import { getPaymentLegalReadiness } from "@/lib/payments/legal";

export const metadata = { robots: { index: false, follow: false } };

export default async function CheckoutTermsPage() {
    const legal = getPaymentLegalReadiness();
    const locale = normalizeAppLocale((await cookies()).get(LOCALE_COOKIE_NAME)?.value);
    const en = locale === "en";
    return (
        <LegalDocumentPage locale={locale} eyebrow={en ? "Purchase terms" : "Satın alma koşulları"} title={en ? "Digital Product Purchase Terms" : "Dijital Ürün Satın Alma Koşulları"} version={legal.checkoutTermsVersion} ready={legal.ready}>
            <LegalSection title={en ? "Order and delivery" : "Sipariş ve teslim"}>
                <p>{en ? "The purchased digital product is assigned to the user account specified in the order after the provider verifies payment. A success redirect alone is not proof of payment." : "Satın alınan dijital ürün, ödemenin sağlayıcı tarafından doğrulanmasından sonra siparişte belirtilen kullanıcı hesabına tanımlanır. Başarı yönlendirmesi tek başına ödeme kanıtı değildir."}</p>
            </LegalSection>
            <LegalSection title={en ? "Account and use" : "Hesap ve kullanım"}>
                <p>{en ? "Users may place orders only for their own accounts. Product transfers, account sales, and automated abuse of the payment flow are prohibited. A security review does not mean an automatic severe penalty will be applied to rewards earned through gameplay." : "Kullanıcı, yalnız kendi hesabı için sipariş verebilir. Ürün devri, hesap satışı ve ödeme akışının otomasyonla kötüye kullanılması yasaktır. Güvenlik incelemesi, oyunla kazanılmış ödüllere otomatik ağır ceza uygulanması anlamına gelmez."}</p>
            </LegalSection>
            <LegalSection title={en ? "Refunds and payment disputes" : "İade ve ödeme itirazı"}>
                <p>{en ? "Refund, withdrawal, and commencement-of-use conditions for digital content are assessed under the product terms and applicable law. In a chargeback or payment cancellation, only the related paid entitlement may be frozen or revoked; every case is reviewed against recorded evidence." : "İade, cayma ve dijital içeriğin kullanılmaya başlanmasına ilişkin koşullar ürün ve yürürlükteki mevzuata göre değerlendirilir. Chargeback veya ödeme iptalinde yalnız ilgili ücretli kazanım dondurulabilir ya da geri alınabilir; her olay kayıtlar üzerinden incelenir."}</p>
            </LegalSection>
            <LegalSection title={en ? "Support" : "Destek"}>
                <p>{en ? "Purchase support" : "Satın alma desteği"}: {legal.contactEmail ?? (en ? "[Support email address]" : "[Destek e-posta adresi]")}. {en ? "Business" : "İşletme"}: {legal.businessName ?? (en ? "[Business name]" : "[İşletme unvanı]")}.</p>
            </LegalSection>
        </LegalDocumentPage>
    );
}
