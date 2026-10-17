# Word Packs

Curated game content for the closed alpha. Each CSV is one pack for one content
language and is imported through the admin bulk upload.

| File | Language | Cards | Categories | Easy / Medium / Hard |
| --- | --- | --- | --- | --- |
| `tr-core-v1.csv` | `tr` (Türkçe paket) | 520 | 10 x 52 | 210 / 210 / 100 |
| `en-core-v1.csv` | `en` (English pack) | 420 | 10 x 42 | 170 / 170 / 80 |

The English pack is written for English speakers. It is not a translation of
the Turkish pack.

## File format

The format is the `csv_categories` mode of `/api/admin/words/bulk-upload`:

```text
kelime,zorluk,kategori,alt_kategori,yasak1,yasak2,yasak3,yasak4,yasak5
word,difficulty,category,subcategory,taboo1,taboo2,taboo3,taboo4,taboo5
```

- The first line is the header. The uploader skips a first line that starts
  with `kelime` or `word`.
- Fields are split on every comma. Quotes are not supported, so no field may
  contain a comma, a quote or a semicolon.
- `zorluk` is `1` (easy, "Kolay"), `2` (medium, "Orta") or `3` (hard, "Zor").
- `alt_kategori` is always empty. The packs use root categories only.
- Every card has exactly 5 taboo words.
- UTF-8 without a BOM. Turkish-locale Excel saves CSV files with `;` and often
  adds a BOM, so edit the files in a text editor or check the separator and
  encoding before saving.

## Importing

The bulk upload does not create categories. Create them first, with exactly
these names (matching ignores case, but not spelling).

1. Admin -> Kategoriler. Pick the language in "Kelime paketi dili" (Türkçe paket
   or English pack) and add each root category with "Yeni Kategori". The colors
   are suggestions; the card header uses the category color with white text.
2. Admin -> Kelimeler. Pick the same language in "Kelime paketi dili", open
   "Toplu Yukle", choose "CSV Kategorisi", select the file and press
   "Yüklemeyi Başlat".
3. Check the report. "Eklendi" should equal the card count on a fresh database
   and "Hata" should be 0. A "kategorisi bulunamadi" error means a category name
   or language does not match step 1.

| Sort | Türkçe paket | English pack | Suggested color |
| --- | --- | --- | --- |
| 1 | Günlük Yaşam | Everyday Life | `#2563EB` |
| 2 | Yiyecek ve İçecek | Food and Drink | `#C2410C` |
| 3 | Hayvanlar | Animals | `#15803D` |
| 4 | Meslekler | Jobs | `#7C3AED` |
| 5 | Spor | Sports and Games | `#DC2626` |
| 6 | Bilim ve Teknoloji | Science and Tech | `#0E7490` |
| 7 | Coğrafya ve Yerler | Places and Travel | `#B45309` |
| 8 | Doğa | Nature and Weather | `#0F766E` |
| 9 | Tarih ve Kültür | History and Legends | `#9D174D` |
| 10 | Sanat ve Eğlence | Arts and Entertainment | `#A21CAF` |

Notes:

- Uploading the same file again is safe. Words that already exist in that
  language are skipped ("Atlandı") and nothing is changed.
- Word uniqueness follows the database collation (`utf8mb4_unicode_ci`), which
  ignores case and accents. "Gol" is skipped if "Göl" already exists, so the
  validator rejects packs with such pairs.
- A skipped word keeps its old taboo words and category. To change an existing
  card, edit it in Admin -> Kelimeler.
- Limits: 1,000 data rows and 2 MB per file, 10 uploads per minute per admin.

## Content rules

- The taboo words are the most obvious clues a player would reach for.
- No taboo word contains the target, its root or an inflection of it. Turkish
  suffixes count: "Kitap" cannot forbid "Kitapçı", "Kitaplık" or "Kitabı".
- No repeated taboo words on a card, no duplicate targets in a language, and no
  near duplicates such as "Futbol" and "Futbol topu".
- Family-friendly. No brand or trademark names, no living people, no political
  parties or politicians, no religious or ethnically sensitive targets, no
  slurs. Nothing copied from commercial Taboo decks.
- Correct Turkish letters and TDK spelling (for example "Rüzgâr", "Hâkim",
  "Kâğıt", "Istaka", "Kalemtıraş").
- Fields start with a capital letter in sentence case. The game card shows them
  in uppercase.
- Long words must fit the card on a phone: one word of the target at most about
  296 px in the card font (roughly 10 to 11 letters), one word of a taboo entry
  at most 218 px, and at most 3 words per field.
- Difficulty mix is about 40% easy, 40% medium and 20% hard, in every category.

## Adding cards

1. Add rows to an existing pack, or start a new file named
   `<locale>-<name>-v<N>.csv` (for example `tr-holiday-v1.csv`) with the same
   header.
2. If you add a category, list it in the table above and create it in the admin
   before uploading.
3. Run the validator. It parses every pack with the same parser as the upload
   route and checks all of the rules above:

   ```bash
   npm run test:word-packs
   ```

4. Upload the file. Existing words are skipped, so uploading a whole pack again
   only adds the new rows.
