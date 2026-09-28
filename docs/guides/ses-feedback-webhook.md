# SES Feedback Webhook

> Branch: `feature/ses-feedback-webhook-foundation`

## Amaç

Amazon SES üzerinden gönderilen e-postaların bounce, complaint ve delivery
bildirimlerini doğrulanmış Amazon SNS HTTPS mesajlarından almak. SMTP/outbox
akışı değişmez; webhook yalnız provider feedback güven sınırıdır.

## Güvenlik Sözleşmesi

- Route: `POST /api/email/webhooks/ses`
- Endpoint varsayılan olarak `404` döner ve env ile açılır.
- SNS type, message ID ve topic ARN header değerleri body ile birebir eşleşir.
- `TopicArn` yalnız exact `SES_SNS_TOPIC_ARNS` allowlist'inden kabul edilir.
- İmzalı payload içindeki SES `mail.sourceArn` yalnız exact
  `SES_ALLOWED_SOURCE_ARNS` identity allowlist'inden kabul edilir.
- `SigningCertURL` yalnız topic ARN ile aynı AWS partition/region SNS hostuna,
  HTTPS'e ve beklenen sertifika path'ine gidebilir.
- Sertifika isteği redirect izlemez, 4 saniye timeout ve 32 KiB response sınırı
  kullanır. Pozitif sertifikalar altı saat process-local cache'te tutulur.
- Signature V1 RSA-SHA1 ve V2 RSA-SHA256 desteklenir; imza doğrulanmadan SES
  payload parse edilmez veya DB'ye yazılmaz.
- Body 192 KiB ile sınırlıdır ve stream üzerinden bounded okunur.
- Distributed route limiti varsayılan `600/dk` değeridir ve ölçülen SES hacmine
  göre `60..10000` aralığında ayarlanabilir.
- Public provider route'u browser Origin, Referer, cookie veya session istemez.
  Distributed rate limit ve Cloudflare DDoS/WAF katmanı ek kaynak korumasıdır.
- Ham SNS/SES payload, e-posta adresi veya subscription token audit ve
  observability eventlerine yazılmaz.
- Platform tek alıcıya e-posta gönderir. Multi-recipient eventler veya event
  recipient ile `mail.destination` uyuşmazlığı suppression oluşturmaz.

AWS, SNS imza doğrulamasında message type'a göre sabit canonical alan sırası,
AWS sertifika URL kontrolü ve SignatureVersion'a göre hash seçimi ister:
[SNS signature verification](https://docs.aws.amazon.com/sns/latest/dg/sns-verify-signature-of-message-verify-message-signature.html).
SES event alanları ve bounce sınıfları:
[SES event contents](https://docs.aws.amazon.com/ses/latest/dg/event-publishing-retrieving-sns-contents.html).

## Event Davranışı

| SES olayı | Uygulama davranışı |
| --- | --- |
| `Bounce` + `Permanent` | Recipient başına `hard_bounce`, `all` suppression |
| `Bounce` + `Transient` | Başarılı ACK; suppression yok |
| `Complaint` | Recipient başına `complaint`, `all` suppression |
| `Complaint` + `not-spam` | Başarılı ACK; suppression yok |
| Multi-recipient event | Başarılı ACK; suppression yok |
| `Delivery` | Recipient başına `delivered`; suppression yok |
| Diğer eventler | Başarılı ACK; kalıcı event yok |

`provider + SNS MessageId:recipientIndex` unique anahtarı retry'ları idempotent
yapar. Suppression kaydı mevcut outbox worker tarafından provider çağrısından önce
yeniden okunur. Oyuncuya otomatik hesap cezası, suspension veya e-posta değişikliği
uygulanmaz.

## Subscription Confirmation

`SES_SNS_AUTO_CONFIRM=false` güvenli varsayılandır. İmzalı ve allowlist topic'e ait
confirmation geldiğinde route `202` döner ve PII/token içermeyen operasyon sinyali
üretir. Kurulum penceresinde operator:

1. endpoint ve topic ARN'i doğrular,
2. `SES_SNS_AUTO_CONFIRM=true` ile kısa süreli deploy yapar,
3. AWS SNS confirmation tamamlandıktan sonra flag'i tekrar `false` yapar.

Auto-confirm yalnız imzası doğrulanan mesajdaki, aynı SNS region hostuna ait ve
`TopicArn`/`Token` eşleşen URL'yi çağırır. Redirect takip edilmez.

## Production Ayarları

```env
PRODUCTION_EMAIL_POLICY=smtp
EMAIL_PROVIDER=smtp
PRODUCTION_EMAIL_FEEDBACK_POLICY=ses_sns
SES_FEEDBACK_WEBHOOK_ENABLED=true
SES_SNS_TOPIC_ARNS=arn:aws:sns:eu-central-1:123456789012:hushle-ses-feedback
SES_ALLOWED_SOURCE_ARNS=arn:aws:ses:eu-central-1:123456789012:identity/hushle.com
SES_SNS_AUTO_CONFIRM=false
SES_FEEDBACK_WEBHOOK_RATE_LIMIT_PER_MINUTE=600
```

SES kullanılmayan ve bounce/complaint yönetimini başka bir doğrulanmış sağlayıcıya
bırakan kurulum açıkça
`PRODUCTION_EMAIL_FEEDBACK_POLICY=provider_managed_risk_accepted` seçmelidir.
Bu seçim SES endpoint'ini açamaz ve production preflight warning üretir.

Cloudflare'da bu route için browser challenge, Origin/Referer veya session kuralı
uygulanmaz. AWS SNS server-to-server teslimatı yalnız DDoS/managed WAF ile geçirilir;
asıl kimlik doğrulama uygulamadaki SNS imzasıdır.

## Doğrulama

```bash
npm run test:ses-feedback-webhook
npm run test:ses-feedback-route
npm run test:email-delivery-operations
EMAIL_DELIVERY_OPERATIONS_INTEGRATION=true npm run test:email-delivery-operations-integration
npm run test:production-preflight
npm run test:edge-security-policy
npm run typecheck:packages
npm run typecheck:web
npm run build
```

Gerçek production kabulü için SES identity, aynı region SNS topic, HTTPS
subscription, permanent-bounce simulator ve complaint simulator sonuçları admin
e-posta teslimat ekranında doğrulanmalıdır. Fixture testi gerçek AWS teslimat
kanıtı değildir.
