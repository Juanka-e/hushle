import type { Metadata } from "next";
import { ViewerCardPreview } from "@/app/room/[code]/_components/active-game";
import type { CardData } from "@/types/game";

export const metadata: Metadata = {
    title: "Card text QA",
    robots: { index: false, follow: false },
};

interface CardTextFixture {
    key: string;
    card: CardData;
    roomLocale?: CardData["locale"];
}

// Longest realistic words from the TR/EN packs plus two pathological ones.
const fixtures: CardTextFixture[] = [
    {
        key: "tr-kitap",
        card: { id: 1, word: "Kitap", difficulty: 1, categoryColor: "#2563eb", locale: "tr", taboo: ["Okumak", "Sayfa", "Yazar", "Kütüphane", "Roman"] },
    },
    {
        key: "tr-elektrik",
        card: { id: 2, word: "Elektrik mühendisliği", difficulty: 3, categoryColor: "#7c3aed", locale: "tr", taboo: ["Akım", "Devre", "Üniversite", "Mühendis", "Voltaj"] },
    },
    {
        key: "tr-programci",
        card: { id: 3, word: "Bilgisayar programcısı", difficulty: 2, categoryColor: "#0f766e", locale: "tr", taboo: ["Yazılım geliştirici", "Kod", "Algoritma", "Klavye", "İşletim sistemi"] },
    },
    {
        key: "tr-gokkusagi",
        card: { id: 4, word: "Gökkuşağı", difficulty: 1, categoryColor: "#db2777", locale: "tr", taboo: ["Yağmur", "Renkler", "Güneş", "Gökyüzü", "Kuşak"] },
    },
    {
        key: "tr-kaliforniya",
        card: { id: 5, word: "Kaliforniya", difficulty: 2, categoryColor: "#ea580c", locale: "tr", taboo: ["Amerika", "Eyalet", "Los Angeles", "Hollywood", "San Francisco"] },
    },
    {
        key: "tr-bagimsizlik",
        card: { id: 6, word: "Bağımsızlık Günü", difficulty: 2, categoryColor: "#dc2626", locale: "tr", taboo: ["Dört Temmuz", "Amerika Birleşik Devletleri", "Bayram", "Havai fişek", "Kutlama"] },
    },
    {
        key: "tr-room-fallback",
        roomLocale: "tr",
        card: { id: 7, word: "Şişli İskelesi", difficulty: 1, categoryColor: null, taboo: ["İstanbul", "Vapur", "Liman", "Deniz", "Semt"] },
    },
    {
        key: "tr-extreme",
        card: { id: 8, word: "Muvaffakiyetsizleştiricileştiriveremeyebileceklerimizdenmişsinizcesine", difficulty: 3, categoryColor: "#475569", locale: "tr", taboo: ["Uzun kelime", "Türkçe", "Sondan eklemeli", "Ek", "Rekor"] },
    },
    {
        key: "en-electromagnetic",
        card: { id: 9, word: "Electromagnetic", difficulty: 3, categoryColor: "#7c3aed", locale: "en", taboo: ["Magnet", "Electricity", "Field", "Wave", "Radiation"] },
    },
    {
        key: "en-photosynthesis",
        card: { id: 10, word: "Photosynthesis", difficulty: 2, categoryColor: "#16a34a", locale: "en", taboo: ["Plant", "Sunlight", "Chlorophyll", "Oxygen", "Carbon dioxide"] },
    },
    {
        key: "en-independence",
        card: { id: 11, word: "Independence Day", difficulty: 2, categoryColor: "#dc2626", locale: "en", taboo: ["Fourth of July", "Fireworks", "America", "Holiday", "Celebration"] },
    },
    {
        key: "en-pizza",
        card: { id: 12, word: "Pizza", difficulty: 1, categoryColor: "#ea580c", locale: "en", taboo: ["Italy", "Cheese", "Slice", "Delivery", "Pepperoni"] },
    },
    {
        key: "en-extreme",
        card: { id: 13, word: "Pneumonoultramicroscopicsilicovolcanoconiosis", difficulty: 3, categoryColor: "#475569", locale: "en", taboo: ["Lung disease", "Longest word", "Volcano", "Dust", "Silica"] },
    },
];

export default function CardTextTestPage() {
    return (
        <main className="min-h-screen bg-gray-50 text-slate-900 dark:bg-slate-900 dark:text-white">
            <div className="mx-auto grid w-full max-w-[1400px] gap-x-6 gap-y-10 p-4 sm:grid-cols-2 sm:p-6 xl:grid-cols-3">
                {fixtures.map((fixture) => (
                    <section
                        key={fixture.key}
                        data-testid={`card-fixture-${fixture.key}`}
                        className="w-full"
                    >
                        <ViewerCardPreview
                            card={fixture.card}
                            cardFaceTheme={null}
                            cardBackTheme={null}
                            contentLocale={fixture.roomLocale}
                        />
                    </section>
                ))}
            </div>
        </main>
    );
}
