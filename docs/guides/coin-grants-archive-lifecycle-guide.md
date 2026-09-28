# Coin Grants Archive Lifecycle Guide

Bu rehber `fix/coin-grants-archive-lifecycle` branch'i icin kapsam ve karar cizgisini tanimlar.

## Branch Amaci

Coin grant campaign ve code tarafindaki archive davranisini tek ve tutarli bir lifecycle modeline cekmek.

Ana hedef:

- `Tum`, `Aktif`, `Pasif`, `Arsiv` gorunumleri ayni semantik kuralla calissin
- campaign ve code tarafi farkli davranip admin'i sasirtmasin
- archive, delete ve pasiflestirme kavramlari net ayrilsin

## Problem Tanimi

Su anki sorun:

- campaign tarafinda archive edilmis kayitlar bazen `Tum` icinde de kaliyor
- code tarafinda archive davranisi daha dar calisiyor
- admin acisindan ayni panel icinde iki farkli zihinsel model olusuyor

Bu hem operasyonel hata riskini buyutur hem de audit/gozlem akislarini zayiflatir.

## Bu Branch'te Yapilacaklar

### 1. Tek lifecycle dili
- `aktif`
- `pasif`
- `arsiv`

Bu durumlar UI copy, filtre ve backend query tarafinda ayni mantikla tasinacak.

### 2. Filtre semantiklerini netlestirme
- `Tum`
  - arsiv haric tum operasyonel kayitlar
- `Aktif`
  - yayinda olan kayitlar
- `Pasif`
  - arsivde olmayan ama calismayan kayitlar
- `Arsiv`
  - operasyonel akistan cikarilmis kayitlar

### 3. Archive davranisini campaign ve code tarafinda esitleme
- ayni action dili
- ayni listeleme kurali
- ayni gorunurluk davranisi

### 4. Copy ve admin operasyon dili
- `Arsive Kaldir`
- `Arsivden Cikar`
- gerekiyorsa `Pasife Al`

Bir action digerini taklit etmemeli.

## Uygulanan Temel Karar

Bu branch'te lifecycle dili su sekilde uygulanacak:

- `Pasife Al`
  - kaydi operasyonel listede tutar
  - `isActive = false`
  - gizli delete yapmaz
- `Arsive Kaldir`
  - kaydi operasyonel listeden cikarir
  - `archivedAt` doldurur
  - aktif kayit once pasife alinmadan arsivlenmez
- `Arsivden Cikar`
  - kaydi yeniden operasyonel listeye alir
  - varsayilan olarak pasif durumda geri doner

Bu karar, admin'in ekrandaki buton etiketine bastiginda baska bir sey olmamasini garanti etmek icin alindi.

## Guardrail

- audit gecmisi korunacak
- kullanilmis kayitlar hard delete ile kaybedilmeyecek
- archive, operasyonel gorunumden cikarma anlamina gelmeli; veri yok etme anlamina degil
- campaign ve code tarafinda farkli exception kurallari acikca gerekcelendirilmeden ayrismayacak

## Bu Branch'te Bilincli Olarak Yapilmayacaklar

- wallet ledger
- economy abuse
- coin kazanma kurallari
- payment / topup sistemi
- night market veya gorev ekonomisi

## Sonraki Bagli Alanlar

Bu branch temizlenmeden su alanlar daha da karmasiklasir:

- admin coin observability
- wallet ledger
- economy abuse audit
- canli campaign/code operasyonlari
