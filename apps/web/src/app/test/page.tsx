import { ViewerCardPreview } from "@/app/room/[code]/_components/active-game";
import { resolveCardBackTheme } from "@/lib/cosmetics/card-back";
import { resolveCardFaceTheme } from "@/lib/cosmetics/card-face";
import type { CardData } from "@/types/game";

const sampleCard: CardData = {
    id: 101,
    word: "Hushle",
    difficulty: 2,
    categoryColor: "#0f766e",
    taboo: ["Sessiz", "Kelime", "Takim", "Iletisim", "Lobby"],
};

const sampleFaceTheme = resolveCardFaceTheme({
    renderMode: "template",
    imageUrl: "",
    templateKey: "signal_grid",
    templateConfig: {
        palette: {
            primary: "#0f766e",
            secondary: "#99f6e4",
            surface: "#0f172a",
            border: "#5eead4",
            word: "#ecfeff",
            taboo: "#fca5a5",
            footer: "#ccfbf1",
        },
        motion: { preset: "drift", speedMs: 5400 },
        pattern: { type: "grid", opacity: 0.18, scale: 18 },
    },
    rarity: "rare",
});

const sampleBackTheme = resolveCardBackTheme({
    renderMode: "template",
    imageUrl: "",
    templateKey: "midnight_mesh",
    templateConfig: {
        palette: {
            surface: "#111827",
            border: "#60a5fa",
            primary: "#22d3ee",
            secondary: "#93c5fd",
            title: "#e0f2fe",
            detail: "#bae6fd",
        },
        motion: { preset: "drift", speedMs: 6200 },
        pattern: { type: "grid", opacity: 0.2, scale: 18 },
    },
    rarity: "rare",
});

export default function TestPage() {
    return (
        <main className="min-h-screen bg-[radial-gradient(circle_at_top,_#1e293b,_#020617_60%)] px-6 py-12 text-white">
            <div className="mx-auto flex max-w-5xl flex-col gap-10">
                <div className="space-y-4 text-center">
                    <p className="text-xs font-black uppercase tracking-[0.34em] text-cyan-300/80">
                        Hushle QA
                    </p>
                    <h1 className="text-4xl font-black tracking-tight sm:text-5xl">
                        Kart Flip Test Sahnesi
                    </h1>
                    <p className="mx-auto max-w-2xl text-sm text-slate-300 sm:text-base">
                        Default durumda flip kapali olmali. Toggle acildiginda kart
                        tiklama ile on ve arka yuz arasinda donmeli.
                    </p>
                </div>

                <section className="rounded-[2rem] border border-white/10 bg-white/5 p-6 shadow-2xl backdrop-blur">
                    <ViewerCardPreview
                        card={sampleCard}
                        cardFaceTheme={sampleFaceTheme}
                        cardBackTheme={sampleBackTheme}
                    />
                </section>
            </div>
        </main>
    );
}
