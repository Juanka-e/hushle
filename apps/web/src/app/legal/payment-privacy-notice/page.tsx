import { cookies } from "next/headers";
import { LegalDocumentPage, LegalSection } from "@/components/payments/legal-document-page";
import { LOCALE_COOKIE_NAME, normalizeAppLocale } from "@/lib/i18n/config";
import { getPaymentLegalReadiness } from "@/lib/payments/legal";

export const metadata = { robots: { index: false, follow: false } };

export default async function PaymentPrivacyNoticePage() {
    const legal = getPaymentLegalReadiness();
    const locale = normalizeAppLocale((await cookies()).get(LOCALE_COOKIE_NAME)?.value);
    const en = locale === "en";
    const controller = legal.businessName ?? (en ? "[Data controller business name]" : "[Veri sorumlusu işletme unvanı]");
    const contact = legal.contactEmail ?? (en ? "[Request email address]" : "[Başvuru e-posta adresi]");

    return (
        <LegalDocumentPage locale={locale} eyebrow={en ? "Privacy" : "KVKK"} title={en ? "Payment Privacy Notice" : "Ödeme Aydınlatma Metni"} version={legal.privacyNoticeVersion} ready={legal.ready}>
            <LegalSection title={en ? "Data controller" : "Veri sorumlusu"}>
                <p>{en ? `${controller} acts as the data controller for payment operations. Contact and request address: ${contact}.` : `${controller}, ödeme işlemleri kapsamında veri sorumlusu olarak hareket eder. İletişim ve başvuru adresi: ${contact}.`}</p>
            </LegalSection>
            <LegalSection title={en ? "Processed data and purposes" : "İşlenen veriler ve amaçlar"}>
                <p>{en ? "Account identity, order and product details, transaction time, payment-provider references, limited technical security records, and payment results are processed to establish the order, verify collection, deliver the product, manage refunds and disputes, prevent fraud, and meet legal obligations." : "Hesap kimliği, sipariş ve ürün bilgileri, işlem zamanı, ödeme sağlayıcısı referansları, sınırlı teknik güvenlik kayıtları ile ödeme sonucu; siparişin kurulması, tahsilatın doğrulanması, ürünün teslimi, iade/itiraz süreçleri, dolandırıcılığın önlenmesi ve yasal yükümlülüklerin yerine getirilmesi amacıyla işlenir."}</p>
                <p>{en ? "When a PayTR payment session is created, full name, phone, address, and verified account email are sent to PayTR for the transaction. Full name, phone, and address are not copied into Hushle orders, audit records, or application logs." : "PayTR ödeme oturumu oluşturulurken ad-soyad, telefon, adres ve doğrulanmış hesap e-postası işlem için PayTR'ye iletilir. Ad-soyad, telefon ve adres Hushle sipariş, audit veya uygulama log kayıtlarına kopyalanmaz."}</p>
                <p>{en ? "iyzico is currently disabled. If enabled later, required first name, last name, phone, address, and identity-number fields will be shown separately before payment starts; those fields will not be collected before this notice is updated." : "iyzico şu anda etkin değildir. İleride etkinleştirilmesi halinde sağlayıcının zorunlu tuttuğu ad, soyad, telefon, adres ve kimlik numarası alanları ödeme başlatılmadan önce ayrıca gösterilir; aydınlatma metni güncellenmeden bu alanlar toplanmaz."}</p>
                <p>{en ? "Card numbers and security codes are not stored in Hushle systems; they are processed on the selected payment provider's secure payment surface." : "Kart numarası ve kart güvenlik kodu Hushle sistemlerinde tutulmaz; bu bilgiler seçilen ödeme sağlayıcısının güvenli ödeme yüzeyinde işlenir."}</p>
            </LegalSection>
            <LegalSection title={en ? "Retention and data minimization" : "Saklama ve veri minimizasyonu"}>
                <p>{en ? "Full name, phone, address, and any identity number collected in the payment form for provider transmission are used only to construct the related payment request. They are not written to the user profile, order, consent record, audit record, or application telemetry, including in reversible or predictable hash form." : "Ödeme formunda sağlayıcıya iletilmek üzere alınan ad-soyad, telefon, adres ve varsa kimlik numarası yalnız ilgili ödeme isteğinin kurulması sırasında kullanılır. Bu değerler kullanıcı profiline, siparişe, onay kaydına, audit kaydına veya uygulama telemetrisine yazılmaz; geri döndürülebilir ya da tahmin edilebilir hash biçiminde de saklanmaz."}</p>
                <p>{en ? "Hushle may retain the order and product summary, amount, currency, provider references, payment result, and accepted document or policy versions. Provider retention periods and obligations are governed by the provider's terms." : "Hushle tarafında sipariş ve ürün özeti, tutar, para birimi, sağlayıcı referansları, ödeme sonucu ve kabul edilen metin/politika sürümleri saklanabilir. Ödeme sağlayıcısının kendi saklama süreleri ve yükümlülükleri sağlayıcının şartlarına tabidir."}</p>
            </LegalSection>
            <LegalSection title={en ? "Legal basis, collection, and transfer" : "Hukuki sebep, toplama yöntemi ve aktarım"}>
                <p>{en ? "Data is obtained electronically through automated means from the user, application, and payment provider. Processing is based on contract establishment or performance, legal obligations, and legitimate security interests." : "Veriler elektronik ortamda kullanıcı, uygulama ve ödeme sağlayıcısından otomatik yöntemlerle elde edilir. İşleme; sözleşmenin kurulması veya ifası, hukuki yükümlülükler ve meşru menfaat kapsamındaki güvenlik ihtiyaçlarına dayanır."}</p>
                <p>{en ? "Required data may be transferred to payment and infrastructure providers and legally authorized authorities only for the stated purposes. A provider is not enabled if it causes an international transfer until appropriate safeguards, transfer parties, and country information are verified." : "Gerekli veriler ödeme sağlayıcısına, altyapı hizmet sağlayıcılarına ve hukuken yetkili kurumlara amaçla sınırlı olarak aktarılabilir. Bir sağlayıcının veya alt işleyeninin yurt dışı aktarım doğurması halinde uygun hukuki güvence, aktarım tarafları ve ülke bilgisi doğrulanmadan ilgili sağlayıcı etkinleştirilmez."}</p>
            </LegalSection>
            <LegalSection title={en ? "Rights and requests" : "Haklar ve başvuru"}>
                <p>{en ? `Requests to access, correct, delete, object to, or otherwise exercise applicable data-protection rights may be sent to ${contact}. Only information necessary for identity verification is requested.` : `KVKK kapsamındaki bilgi alma, düzeltme, silme, itiraz ve diğer talepler ${contact} adresine iletilebilir. Kimlik doğrulaması için yalnız gerekli bilgiler talep edilir.`}</p>
            </LegalSection>
        </LegalDocumentPage>
    );
}
