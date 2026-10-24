/**
 * ASCII-folded Turkish spellings ("gecersiz" for "geçersiz") that were written into server and admin
 * text before it was spelled with Turkish letters. None of them is a correct Turkish word, so any hit
 * in user-facing text is a regression. Words that are also valid Turkish or common English
 * ("once", "sure", "turu", "hala") are left out on purpose; the stem heuristic in
 * test-player-error-codes.ts covers new words that are not listed here.
 */
export const FOLDED_TURKISH_WORDS: ReadonlySet<string> = new Set(
    `
    bos dus ic kac tum uc ust
    acabilirsin acik acikken aciklayici acilamaz acilis acma adina adlarini akisini akisiyla
    akislarini akislariyla alanlarini alinmis alir alkis altina altinda anlamsizlastirmak araligi
    araliklarla arasinda arayuz arkadaslarinla arsiv asamaz asildikca asiri asiyor askida askiya
    atamasi atlandi ayari ayarlari ayni azalir baglama baglanir baglantilar baglantilari baglantisi
    baglarini baglayamazsin bagli bakim balik bandinda basarisiz basina baska baslangic baslar
    baslatilamadi baslayacagini baslik bazi bazli birak birakirsan bitis blogu bulunamadi buyuk
    cakisma cakismasina calisir calisiyor calismasi canli carpana carpani carpanlari cevabi cikis
    cizgi cozuldu cozulmedi davranisinda davranisini davranislari degeri degerler degil degisikligi
    degistirildi degistirilemez dogrulama dogrulamasi dogrulandi dogrulanmadi dogrulugu donulecek
    dort dosyasi dusme dusmeye dusmez dusuk dusumlerini dusurmek dusurmez dusurulen dusus dususu
    dususun duzenle duzenleme eklenmemis erisim erisimi erisimini esigi esik esikten eslesen
    eslesmiyor etkinlestir farkli fiyatlarina gecerli gecersiz gecici genis genisletmek gerekce
    gerekcesini girildiginde giris girisi gonder gonderildi gonderilecek gonderilemedi gonderiliyor
    gondermeden gore gorsel gorseli gorselidir gorselleri gorulen gorunen gorunumu gorunur
    gorunurluk goster gosterilecek gosterilmez gosterir gozlem guclu guncelle guncelleme
    guncellemesi guncellendi guncellenemedi guncellenmeli guvenli guvenligiyle guvenlik guvenlikte
    hatalari hatali hatasi hazir hazirligi henuz hesabi hesabiniza hesaplari hesaplarinin hizini
    hizli icerebilir icerigi icerik icin icinde icindeki icinden icindir isaretlendi islem islemde
    islemi islemler islemleri istediginize istege istegi izgara izleyecegiz kaldi kaldir kaldirildi
    kaldirilir kaldirir kalici kalir kampanyasi kanit kapali kapatildi kapatilir kapatir karsilamali
    kartlari kartlarinda katalogu katilim katilimini katmanini katmanlari kaydi kaydina kaydini
    kayit kayitlar kayitlari kayitlarini kilcik kisa kisaltilmis kisilik kontrollu kontrolu korumali
    korumasi kucuk kullanici kullanicida kullanicilar kullanicinin kullaniciya kullanilacak
    kullanilan kullanilir kullanima kullanimda kullanir kuyrugu lutfen maclar maclari magaza
    magazaya maglubiyet mantigina marti mesaji numarali odeme odemeyi odul odulleri odullerine
    odullu odulu ogretici okunamadi olcu oldugunda olmadigi olmali olmalidir olmamasi olustu
    olusturma olusturulamadi olusturuldu oncelik oncesi onizleme operasyonlari oranin ornek oynamasi
    oyunlari ozet ozeti paylasildiginda politikasi saglanmadi saklanir satir satiri satirlara
    satislari sayida secerek secersen secildi secildiyse secilen secili secilmedi secim secimi
    secimini secmezsen sekilde sifre siniri sinirlandirildi sinirli siralama siralamasi sonrasi
    sonrasinda sonuc sozcuk surekli sutun sutununu takim tamamlanamadi tamamlandi tanimli tarafinda
    tarafindan tarayici tarayicisindan tasima tasimadan tasinarak tasinip tasir tasiyin tavani
    tekrarini tekrarlarinda toplami tukenen ucmak ulasan uretilen urunleri uste uyari uyarilar
    uygulanamadi uygulanir uygulaniyor uygulayamazsiniz uzantisi uzerinden varsayilan varsayilana
    veritabani yakin yaklasan yalniz yalnizca yapilandirmasi yapilmaz yapinin yapiyorsa yardim
    yarisi yasakli yazilir yazin yogun yonet yonetici yonetimi yonetin yukle yukleme yuklemek
    yuklemesi yuklendi yuklenemedi yukleniyor yuklenmez yuksek yumusak yuzdesel yuzdesi yuzeyi
    yuzeyinde yuzeyinden yuzeylerde yuzeylere zayif
    acildiginda alanina asagidaki calis cubugunda donmeli gostermek hazirlaniyor hesabina odasi saklandi takiminla tiklama yonlendirme
    `
        .trim()
        .split(/\s+/)
);

/** Correct words that start with "i": capitalized, they need a dotted "İ" ("İptal", not "Iptal"). */
const DOTTED_I_WORDS: ReadonlySet<string> = new Set(
    "iade iki ikinci ilgili ilk inceleme indirim indirimi indirimleri iptal isim istatistikler istek istersen izleyiciler izole".split(" ")
);

/**
 * Folded words in `text`, compared case-insensitively on ASCII words only. All-caps words are skipped:
 * a capital "I" is correct for "ı" ("SINIRLI"), so caps cannot be told apart from folded text.
 */
export function findFoldedTurkishWords(text: string): string[] {
    return (text.match(/[A-Za-z0-9_çğıöşüÇĞİÖŞÜ]+/g) ?? [])
        .filter((word) => /^[A-Za-z]+$/.test(word))
        .filter((word) => word.length === 1 || word !== word.toUpperCase())
        .filter(
            (word) =>
                FOLDED_TURKISH_WORDS.has(word.toLowerCase()) ||
                (word.startsWith("I") && DOTTED_I_WORDS.has(word.toLowerCase()))
        );
}
