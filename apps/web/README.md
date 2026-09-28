# apps/web

Ana Next.js ve Socket.IO uygulamasi.

Bu hedef runtime sunlari tasir:

- oyuncu web deneyimi
- admin paneli
- auth akisi
- UI'ya yakin BFF route'lari

## Runtime

- `src/app`: oyuncu, admin ve BFF/API route'lari
- `src/components`: paylasilan web arayuzu
- `src/lib`: web runtime servisleri ve Socket.IO oyun akisi
- `server.ts`: Next.js ile Socket.IO'yu ayni HTTP sunucusunda calistirir

Kok `package.json` komutlari bu workspace'e delege edilir. Ortam degiskenleri
geriye uyumluluk icin repository kokundeki `.env*` dosyalarindan yuklenir.
