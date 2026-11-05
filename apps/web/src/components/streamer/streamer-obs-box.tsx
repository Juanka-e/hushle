"use client";

import { useEffect, useState } from "react";
import { MonitorPlay } from "lucide-react";
import type { CameraSize, CameraSlot } from "@hushle/domain-streamer";
import { DashboardSection } from "@/components/game/dashboard-page-shell";
import { useI18n } from "@/components/providers/i18n-provider";
import type { TranslationKey } from "@/lib/i18n/dictionaries";
import type { StreamUrls } from "@/types/streamer-session";
import { cameraMeasurements, streamUrlsFor } from "./streamer-panel-model";

// The addresses the host gives OBS, the camera hole's measurements and the key rotation. The
// view key exists only in the panel's memory, from the create or rotate answer: it is never
// stored, logged or put anywhere but these fields. Stream URLs open as plain new-tab links (a
// client-side navigation would draw the screen inside the app chrome; framing is refused).

const URL_ROWS: Array<{ key: keyof StreamUrls; testId: string; label: TranslationKey; size: [number, number] }> = [
    { key: "full", testId: "streamer-url-full", label: "streamer.panel.urlFull", size: [1920, 1080] },
    { key: "half", testId: "streamer-url-half", label: "streamer.panel.urlHalf", size: [960, 1080] },
    { key: "stripTop", testId: "streamer-url-strip-top", label: "streamer.panel.urlStripTop", size: [1920, 220] },
    { key: "stripBottom", testId: "streamer-url-strip-bottom", label: "streamer.panel.urlStripBottom", size: [1920, 220] },
];

const COPIED_FOR_MS = 2_000;

export interface StreamerObsBoxProps {
    viewKey: string | null;
    camera: CameraSlot;
    cameraSize: CameraSize;
    /** Asks for a new key (the caller confirms first); disabled while that or another action runs. */
    onRotate: () => void;
    rotating: boolean;
    disabled: boolean;
    rotated: boolean;
}

export function StreamerObsBox({ viewKey, camera, cameraSize, onRotate, rotating, disabled, rotated }: StreamerObsBoxProps) {
    const { t } = useI18n();
    const [copied, setCopied] = useState<string | null>(null);
    const [copyFailed, setCopyFailed] = useState(false);

    useEffect(() => {
        if (!copied) return;
        const timer = setTimeout(() => setCopied(null), COPIED_FOR_MS);
        return () => clearTimeout(timer);
    }, [copied]);

    // viewKey is only ever set in the browser, after a create or rotate answer.
    const urls = viewKey && typeof window !== "undefined" ? streamUrlsFor(window.location.origin, viewKey) : null;
    const rect = cameraMeasurements(camera, cameraSize);
    const cameraLines = rect
        ? [
              t("streamer.panel.cameraRect", { label: "1080p", ...rect.p1080 }),
              t("streamer.panel.cameraRect", { label: "720p", ...rect.p720 }),
          ]
        : [];

    const copy = (id: string, text: string) => {
        setCopyFailed(false);
        const clipboard = typeof navigator !== "undefined" ? navigator.clipboard : undefined;
        if (!clipboard) {
            setCopyFailed(true);
            return;
        }
        clipboard.writeText(text).then(
            () => setCopied(id),
            () => setCopyFailed(true)
        );
    };

    return (
        <DashboardSection
            title={t("streamer.panel.obsTitle")}
            description={t("streamer.panel.obsHelp")}
            action={<MonitorPlay size={18} className="text-violet-600" aria-hidden="true" />}
        >
            <div data-testid="streamer-obs" className="space-y-4">
                {urls ? (
                    <>
                        {URL_ROWS.map((row) => {
                            const label = t(row.label);
                            const done = copied === row.key;
                            return (
                                <div key={row.key} data-testid={row.testId} className="space-y-1.5">
                                    <div className="flex items-baseline justify-between gap-2">
                                        <span className="text-sm font-black text-slate-800 dark:text-slate-100">{label}</span>
                                        <span className="text-xs text-slate-500 dark:text-slate-400">
                                            {t("streamer.panel.urlSize", { w: row.size[0], h: row.size[1] })}
                                        </span>
                                    </div>
                                    <div className="flex gap-2">
                                        <input
                                            readOnly
                                            value={urls[row.key]}
                                            aria-label={label}
                                            onFocus={(event) => event.currentTarget.select()}
                                            className="min-h-11 min-w-0 flex-1 rounded-xl border border-slate-200 bg-slate-50 px-3 font-mono text-xs text-slate-700 dark:border-slate-700 dark:bg-slate-900 dark:text-slate-200"
                                        />
                                        <button
                                            type="button"
                                            onClick={() => copy(row.key, urls[row.key])}
                                            className={`min-h-11 shrink-0 rounded-xl px-4 text-sm font-black transition ${
                                                done
                                                    ? "bg-emerald-600 text-white"
                                                    : "bg-slate-900 text-white hover:bg-slate-800 dark:bg-white dark:text-slate-900"
                                            }`}
                                        >
                                            {done ? t("streamer.panel.copied") : t("streamer.panel.copy")}
                                        </button>
                                    </div>
                                </div>
                            );
                        })}
                        <a
                            href={urls.full}
                            target="_blank"
                            rel="noopener noreferrer"
                            className="inline-block text-sm font-bold text-violet-700 underline dark:text-violet-300"
                        >
                            {t("streamer.panel.preview")}
                        </a>
                    </>
                ) : (
                    <p className="rounded-2xl border border-amber-200 bg-amber-50 p-4 text-sm font-semibold text-amber-800 dark:border-amber-900/60 dark:bg-amber-950/30 dark:text-amber-200">
                        {t("streamer.panel.keyHidden")}
                    </p>
                )}
                {copyFailed ? (
                    <p role="alert" className="text-sm text-rose-700 dark:text-rose-300">
                        {t("streamer.panel.copyFailed")}
                    </p>
                ) : null}
                {rotated && urls ? (
                    <p role="status" className="text-sm font-semibold text-emerald-700 dark:text-emerald-300">
                        {t("streamer.panel.rotated")}
                    </p>
                ) : null}
                <button
                    type="button"
                    onClick={onRotate}
                    disabled={disabled || rotating}
                    className="min-h-11 rounded-xl border border-slate-200 bg-white px-4 text-sm font-black text-slate-700 transition hover:bg-slate-50 disabled:cursor-not-allowed disabled:opacity-50 dark:border-slate-700 dark:bg-slate-950 dark:text-slate-200"
                >
                    {rotating ? t("streamer.panel.rotating") : t("streamer.panel.rotate")}
                </button>

                <div className="rounded-2xl border border-slate-200 bg-slate-50/80 p-4 dark:border-slate-700 dark:bg-slate-900/60">
                    <p className="text-sm font-black text-slate-800 dark:text-slate-100">{t("streamer.panel.cameraTitle")}</p>
                    {rect ? (
                        <>
                            <p className="mt-1 text-xs text-slate-500 dark:text-slate-400">{t("streamer.panel.cameraHelp")}</p>
                            <ul data-testid="streamer-camera-rect" className="mt-2 space-y-1 font-mono text-sm text-slate-700 dark:text-slate-200">
                                {cameraLines.map((line) => (
                                    <li key={line}>{line}</li>
                                ))}
                            </ul>
                            <button
                                type="button"
                                onClick={() => copy("camera", cameraLines.join("\n"))}
                                className={`mt-3 min-h-10 rounded-xl px-4 text-xs font-black transition ${
                                    copied === "camera"
                                        ? "bg-emerald-600 text-white"
                                        : "border border-slate-200 bg-white text-slate-700 hover:bg-slate-50 dark:border-slate-700 dark:bg-slate-950 dark:text-slate-200"
                                }`}
                            >
                                {copied === "camera" ? t("streamer.panel.copied") : t("streamer.panel.copyCamera")}
                            </button>
                        </>
                    ) : (
                        <p className="mt-1 text-sm text-slate-600 dark:text-slate-300">{t("streamer.panel.cameraNone")}</p>
                    )}
                </div>
            </div>
        </DashboardSection>
    );
}
