# Text Encoding Policy

Repo metin dosyalari UTF-8 olarak tutulur. Yeni dosyalar BOM kullanmaz ve
`.editorconfig` bu tercihi editorlere bildirir.

## Kurallar

1. Kaynak, dokuman, JSON, YAML, shell ve HTML dosyalari UTF-8 olmalidir.
2. UTF-16 lint/typecheck ciktilari repoya commit edilmez.
3. `eslint-errors.txt`, `eslint_report.json`, `typescript-errors.txt` ve
   `lint_utf8.txt` gecici raporlardir ve `.gitignore` ile dislanir.
4. Mojibake goruldugunde metni elle tahmin ederek parca parca degistirmek yerine
   orijinal byte encoding'i belirlenir.
5. PowerShell'de bozuk gorunum tek basina dosyanin bozuk oldugunu kanitlamaz.
   Kontrol icin `Get-Content -Encoding utf8` veya byte tabanli test kullanilir.
6. Socket event adlarinda yeni istemciler ASCII kontratlari kullanir.

## Legacy Socket Siniri

Eski istemcilerin yanlis encode edilmis dort room-control event alias'i server
tarafinda gecici olarak desteklenir. Kaynakta mojibake metin gostermek yerine
exact runtime degeri Unicode escape ile korunur. Yeni client bu alias'lari
emit etmez:

- `oyun_baslat`
- `oyun_kontrol`
- `oyun_sifirla`
- `takim_degistir`

Legacy alias kaldirma karari ancak eski client trafiginin kalmadigi
dogrulandiktan sonra ayri bir compatibility degisikligi olarak yapilir.

## Dogrulama

```bash
npm run test:encoding-integrity
```

Test:

- tracked metin dosyalarinin UTF-8 decode edilebildigini
- UTF-16 BOM bulunmadigini
- yaygin mojibake marker'larinin geri gelmedigini
- stale raporlarin calisma agacinda bulunmadigini
- ASCII socket kontratlari ve escaped legacy alias'in korundugunu

dogrular.
