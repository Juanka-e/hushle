# `@hushle/platform-player`

Web ve mobil API'nin ortak oyuncu profil servisidir.

- `/v1/me` için sınırlı player-core görünümü üretir
- profil doğrulaması ve e-posta normalizasyonunu tek yerde tutar
- profil/e-posta güncellemesi ile audit kayıtlarını aynı transaction'da yazar
- inventory listesini player-core cevabına dahil etmez

Transport auth, rate-limit ve HTTP hata çevirisi uygulama adapter'larının
sorumluluğudur.
