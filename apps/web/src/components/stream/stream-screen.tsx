"use client";

import { useParams } from "next/navigation";
import { useEffect, useRef } from "react";
import { loadDemoScene } from "./stream-demo-loader";
import { streamFontClassName } from "./stream-fonts";
import { createStreamRenderer, offlineState, urlLookSnapshot, viewFromParams } from "./stream-renderer";
import { connectStreamTransport, createStreamSocket } from "./stream-transport";
import "./stream-screen.css";

// The public stream screen (OBS browser source): the V4 prototype's public.html. React draws
// this markup once; stream-renderer.ts drives it from the snapshots, as public.js did, and
// stream-transport.ts brings them from the public room. Until the first state arrives the look
// chosen in the URL shows; without one for a while, the offline scene does. The demo scenes
// (stream-demo.ts) are a chunk of their own, fetched only for an allowed ?demo=; a chunk that
// fails to load draws the URL look's offline scene (stream-demo-loader.ts).

export function StreamScreen({ demoAllowed }: { demoAllowed: boolean }) {
    const rootRef = useRef<HTMLElement>(null);
    const viewKey = useParams<{ viewKey: string }>()?.viewKey ?? "";

    useEffect(() => {
        const root = rootRef.current;
        if (!root) return;
        const params = new URLSearchParams(window.location.search);
        const demo = demoAllowed && params.has("demo");
        const renderer = createStreamRenderer(root, viewFromParams(params, demo));
        if (demo) {
            const stopDemo = loadDemoScene(renderer, params, () => import("./stream-demo"));
            return () => {
                stopDemo();
                renderer.destroy();
            };
        }
        const look = urlLookSnapshot(params);
        renderer.render(look);
        const showOffline = () => renderer.render(offlineState(renderer.current() ?? look));
        const transport = connectStreamTransport({
            viewKey,
            socket: createStreamSocket(),
            onState: (state) => renderer.render(state),
            onOffline: showOffline,
            // A session that ended drew its finale just before; anything else goes dark.
            onEnded: () => {
                if (renderer.current()?.phase !== "ended") showOffline();
            },
        });
        return () => {
            transport.close();
            renderer.destroy();
        };
    }, [demoAllowed, viewKey]);

    return (
        <main
            ref={rootRef}
            className={`hushle-stream ${streamFontClassName}`}
            data-theme="oyun-gecesi"
            data-phase="ready"
            data-layout="full"
            data-scores="wide"
            data-last="wide"
            data-timer="tall"
            data-clock="hourglass"
        >
            <div className="stage" id="stage">
                <div className="scene" aria-hidden="true">
                    <div className="scene-art" id="scene-art" />
                </div>
                <div className="camera" id="camera" aria-hidden="true">
                    <span className="camera-hint">Kameran burada</span>
                    <div className="camera-frame" />
                </div>

                <header className="masthead slot">
                    <strong className="brand">Hushle</strong>
                    <span className="channel" id="channel" />
                </header>

                <section className="hero slot" aria-label="Kart">
                    <div className="deck" aria-hidden="true">
                        <i />
                        <i />
                        <i />
                    </div>
                    <div className="card" id="card">
                        <div className="card-inner">
                            <div className="card-face card-back" id="card-back" />
                            <div className="card-face card-front" id="card-front">
                                <div className="front-art" id="front-art" />
                                <span className="front-round" id="front-round" />
                                <div className="front-text">
                                    <strong className="front-target" id="reveal-target" />
                                    <span className="front-label">Yasak kelimeler</span>
                                    <ul className="front-taboos" id="reveal-taboos" />
                                </div>
                            </div>
                        </div>
                    </div>
                    <p className="card-name" id="card-name" hidden />
                    <p className="pause-sign" id="pause-sign">
                        Kısa bir ara
                    </p>
                    <div className="winner" id="winner" hidden>
                        <span className="winner-label" id="winner-label">
                            Gecenin kazananı
                        </span>
                        <strong className="winner-name" id="winner-name" />
                        <span className="winner-points" id="winner-points" />
                    </div>
                </section>

                <section className="timer slot" role="timer" aria-live="off">
                    <span className="round" id="round">
                        1. tur
                    </span>
                    <svg className="clock hourglass" data-kind="hourglass" id="hourglass" viewBox="0 0 200 340" aria-hidden="true">
                        <defs>
                            <clipPath id="glass-top">
                                <path d="M40 30H160C160 95 112 140 104 170H96C88 140 40 95 40 30Z" />
                            </clipPath>
                            <clipPath id="glass-bottom">
                                <path d="M96 170H104C112 200 160 245 160 310H40C40 245 88 200 96 170Z" />
                            </clipPath>
                        </defs>
                        <path
                            className="glass"
                            d="M40 30H160C160 95 112 140 104 170C112 200 160 245 160 310H40C40 245 88 200 96 170C88 140 40 95 40 30Z"
                        />
                        <g clipPath="url(#glass-top)">
                            <rect className="sand sand-top" x="30" y="40" width="140" height="130" />
                        </g>
                        <g clipPath="url(#glass-bottom)">
                            <rect className="sand sand-bottom" x="30" y="180" width="140" height="130" />
                        </g>
                        <line className="sand-stream" x1="100" y1="168" x2="100" y2="308" />
                        <path className="glass-shine" d="M54 42C58 84 80 116 92 140M54 298C58 256 80 224 92 200" />
                        <rect className="frame" x="8" y="6" width="184" height="24" rx="7" />
                        <rect className="frame" x="8" y="310" width="184" height="24" rx="7" />
                        <rect className="frame post" x="18" y="30" width="9" height="280" rx="4" />
                        <rect className="frame post" x="173" y="30" width="9" height="280" rx="4" />
                    </svg>
                    {/* Candle: the wax burns down with the round; the flame rides on top. */}
                    <svg className="clock taper" data-kind="candle" viewBox="0 0 200 340" aria-hidden="true">
                        <g className="candle-top">
                            <ellipse className="candle-glow" cx="100" cy="50" rx="90" ry="64" />
                            <path className="smoke" d="M100 60C112 44 88 34 100 18C112 2 90 -8 100 -24" />
                            <path className="flame-outer" d="M100 6C113 26 122 40 122 54C122 67 112 76 100 76C88 76 78 67 78 54C78 40 87 26 100 6Z" />
                            <path className="flame-inner" d="M100 34C106 44 111 51 111 58C111 65 106 70 100 70C94 70 89 65 89 58C89 51 94 44 100 34Z" />
                            <rect className="wick" x="98" y="58" width="4" height="14" rx="2" />
                            <path className="drip" d="M70 74V110C70 117 80 117 80 110V74Z" />
                            <path className="drip" d="M118 74V98C118 104 127 104 127 98V74Z" />
                            <ellipse className="wax-top" cx="100" cy="74" rx="30" ry="7" />
                        </g>
                        <rect className="wax" x="70" y="74" width="60" height="206" />
                        <path className="holder" d="M58 280H142L152 298H48Z" />
                        <rect className="holder" x="88" y="298" width="24" height="16" />
                        <path className="holder" d="M38 314H162C170 320 170 330 162 336H38C30 330 30 320 38 314Z" />
                    </svg>
                    {/* Studio board: a ring of marquee bulbs that go out one by one. */}
                    <svg className="clock board" data-kind="bulbs" viewBox="0 0 300 300" aria-hidden="true">
                        <circle className="plate" cx="150" cy="150" r="148" />
                        <circle className="plate-rim" cx="150" cy="150" r="112" />
                        <g id="bulb-ring" />
                    </svg>
                    {/* Incense: a stick that shortens; the ember and the smoke follow its tip. */}
                    <svg className="clock incense" data-kind="incense" viewBox="0 0 200 340" aria-hidden="true">
                        <g className="incense-top">
                            <path className="smoke s1" d="M100 40C112 24 88 12 100 -4C112 -20 90 -30 100 -46" />
                            <path className="smoke s2" d="M100 40C92 26 110 14 100 0C92 -14 108 -26 100 -42" />
                            <circle className="ember-glow" cx="100" cy="42" r="16" />
                            <circle className="ember" cx="100" cy="42" r="5" />
                        </g>
                        <rect className="stick" x="96" y="40" width="8" height="226" rx="2" />
                        <path className="bowl" d="M44 262H156C154 300 134 318 100 318C66 318 46 300 44 262Z" />
                        <ellipse className="bowl-sand" cx="100" cy="262" rx="56" ry="10" />
                        <ellipse className="ash" cx="100" cy="259" rx="6" ry="3" />
                        <path className="bowl-foot" d="M72 318H128L124 328H76Z" />
                    </svg>
                    {/* Counter: a plain digital display; the bar under the digits empties from the right. */}
                    <svg className="clock counter" data-kind="counter" viewBox="0 0 260 200" aria-hidden="true">
                        <rect className="bezel" x="2" y="2" width="256" height="196" rx="22" />
                        <rect className="screen" x="14" y="14" width="232" height="128" rx="14" />
                        <g id="segment-bar" />
                    </svg>
                    {/* Ring: a plain arc that empties clockwise. */}
                    <svg className="clock ring" data-kind="ring" viewBox="0 0 300 300" aria-hidden="true">
                        <circle className="track" cx="150" cy="150" r="128" />
                        <circle className="arc" cx="150" cy="150" r="128" pathLength={100} />
                    </svg>
                    <strong className="seconds" id="seconds">
                        60
                    </strong>
                    <span className="seconds-note" id="seconds-note" />
                    <div className="verdict" id="verdict" aria-live="polite">
                        <strong className="verdict-word" id="verdict-word" />
                        <span className="verdict-detail" id="verdict-detail" />
                    </div>
                </section>

                <p className="prompt slot" id="prompt" />

                <section className="scores slot" aria-labelledby="scores-title">
                    <h2 className="scores-title" id="scores-title">
                        Skor
                    </h2>
                    <ol className="score-list" id="scores" />
                    <p className="participants" id="participants" />
                </section>

                <section className="last slot" id="last" aria-live="polite">
                    <span className="last-label">Son bilen</span>
                    <strong className="last-name" id="last-name" />
                    <span className="last-empty" id="last-empty">
                        Henüz kimse bilmedi
                    </span>
                    <span className="last-detail" id="last-detail" />
                    <span className="last-points" id="last-points" hidden>
                        +1
                    </span>
                </section>

                <div className="strip-chip" id="strip-chip" aria-hidden="true" />
            </div>
        </main>
    );
}
