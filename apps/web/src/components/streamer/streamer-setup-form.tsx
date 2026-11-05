"use client";

import { useState, type ReactNode } from "react";
import { Check } from "lucide-react";
import {
    BROADCAST_THEMES,
    CAMERA_SIZES,
    CAMERA_SLOTS,
    TIMER_STYLES,
    type BroadcastTheme,
    type CameraSize,
    type CameraSlot,
    type ClockStyle,
} from "@hushle/domain-streamer";
import { DashboardSection } from "@/components/game/dashboard-page-shell";
import { useI18n } from "@/components/providers/i18n-provider";
import { PlayerErrorCode } from "@/lib/errors/player-error-codes";
import { resolveApiErrorMessage } from "@/lib/errors/resolve-player-error";
import type { TranslationKey } from "@/lib/i18n/dictionaries";
import { runRequest } from "@/lib/run-request";
import { MAX_STREAM_CATEGORIES, STREAM_ROUND_DURATION, type ScreenSettingsPatch } from "@/lib/streamer/session-settings";
import type {
    CardBackOption,
    CreateSessionInput,
    CreateStreamSessionResponse,
    StreamerPanelCategory,
    StreamerPanelChannel,
} from "@/types/streamer-session";

// "Yeni oturum aç": channel, word language, categories (the visible ones of that language, as
// rooms list them), difficulty, round length, guess check and the stream screen look. The last
// session's choices prefill it. Categories come from the page (server-side); nothing is fetched here.

export type ScreenFieldValues = Pick<CreateSessionInput, "theme" | "camera" | "cameraSize" | "clock" | "cardBack" | "showCardName">;

const DURATION_CHOICES = [30, 45, 60, 90, 120] as const;
const DIFFICULTIES = [
    { value: 1, label: "room.easy" },
    { value: 2, label: "room.medium" },
    { value: 3, label: "room.hard" },
] as const satisfies ReadonlyArray<{ value: 1 | 2 | 3; label: TranslationKey }>;
const CORNER_SLOTS: readonly CameraSlot[] = ["tl", "tr", "bl", "br"];

const fieldClass =
    "min-h-11 w-full rounded-xl border border-slate-200 bg-white px-3 text-sm font-bold text-slate-800 disabled:cursor-not-allowed disabled:opacity-50 dark:border-slate-700 dark:bg-slate-950 dark:text-slate-100";
const labelClass = "text-xs font-black uppercase tracking-[0.14em] text-slate-500 dark:text-slate-400";

function toggleClass(selected: boolean): string {
    return `min-h-11 rounded-xl border px-4 text-sm font-black transition disabled:cursor-not-allowed disabled:opacity-50 ${
        selected
            ? "border-violet-600 bg-violet-600 text-white shadow-sm"
            : "border-slate-200 bg-white text-slate-700 hover:bg-slate-50 dark:border-slate-700 dark:bg-slate-950 dark:text-slate-200"
    }`;
}

function flatIds(categories: StreamerPanelCategory[]): number[] {
    return categories.flatMap((root) => [root.id, ...root.children.map((child) => child.id)]);
}

function Field({ label, children }: { label: string; children: ReactNode }) {
    return (
        <div className="space-y-2">
            <p className={labelClass}>{label}</p>
            {children}
        </div>
    );
}

// ---------------------------------------------------------------- the stream screen look

/** Theme, camera hole, timer and card back: used by the form and, live, by the panel (each change is a patch). */
export function ScreenSettingsFields({
    value,
    cardBacks,
    disabled = false,
    onChange,
}: {
    value: ScreenFieldValues;
    cardBacks: CardBackOption[];
    disabled?: boolean;
    onChange: (patch: ScreenSettingsPatch) => void;
}) {
    const { t } = useI18n();
    const corner = CORNER_SLOTS.includes(value.camera);
    const cardBackId = value.cardBack?.itemId ?? null;
    return (
        <div className="grid gap-4 sm:grid-cols-2">
            <label className="space-y-2">
                <span className={labelClass}>{t("streamer.panel.themeLabel")}</span>
                <select
                    className={fieldClass}
                    value={value.theme}
                    disabled={disabled}
                    onChange={(event) => onChange({ theme: event.target.value as BroadcastTheme })}
                >
                    {BROADCAST_THEMES.map((theme) => (
                        <option key={theme} value={theme}>
                            {t(`streamer.panel.themes.${theme}`)}
                        </option>
                    ))}
                </select>
            </label>
            <label className="space-y-2">
                <span className={labelClass}>{t("streamer.panel.clockLabel")}</span>
                <select
                    className={fieldClass}
                    value={value.clock ?? ""}
                    disabled={disabled}
                    onChange={(event) => onChange({ clock: event.target.value ? (event.target.value as ClockStyle) : null })}
                >
                    <option value="">{t("streamer.panel.clockTheme")}</option>
                    {TIMER_STYLES.map((clock) => (
                        <option key={clock} value={clock}>
                            {t(`streamer.panel.clocks.${clock}`)}
                        </option>
                    ))}
                </select>
            </label>
            <label className="space-y-2">
                <span className={labelClass}>{t("streamer.panel.cameraLabel")}</span>
                <select
                    className={fieldClass}
                    value={value.camera}
                    disabled={disabled}
                    onChange={(event) => onChange({ camera: event.target.value as CameraSlot })}
                >
                    {CAMERA_SLOTS.map((slot) => (
                        <option key={slot} value={slot}>
                            {t(`streamer.panel.cameras.${slot}`)}
                        </option>
                    ))}
                </select>
            </label>
            <label className="space-y-2">
                <span className={labelClass}>{t("streamer.panel.cameraSizeLabel")}</span>
                <select
                    className={fieldClass}
                    value={value.cameraSize}
                    disabled={disabled || !corner}
                    onChange={(event) => onChange({ cameraSize: event.target.value as CameraSize })}
                >
                    {CAMERA_SIZES.map((size) => (
                        <option key={size} value={size}>
                            {t(`streamer.panel.cameraSizes.${size}`)}
                        </option>
                    ))}
                </select>
            </label>
            <label className="space-y-2">
                <span className={labelClass}>{t("streamer.panel.cardBackLabel")}</span>
                <select
                    className={fieldClass}
                    value={cardBackId === null ? "" : String(cardBackId)}
                    disabled={disabled}
                    onChange={(event) => {
                        const itemId = Number(event.target.value);
                        onChange({ cardBack: event.target.value && Number.isInteger(itemId) ? { itemId } : null });
                    }}
                >
                    <option value="">{t("streamer.panel.cardBackTheme")}</option>
                    {cardBacks.map((option) => (
                        <option key={option.itemId} value={String(option.itemId)}>
                            {option.owned ? option.name : t("streamer.panel.cardBackShowcase", { name: option.name })}
                        </option>
                    ))}
                </select>
            </label>
            <label className="flex items-center gap-3 self-end rounded-xl border border-slate-200 bg-white px-3 py-2.5 text-sm font-bold text-slate-700 dark:border-slate-700 dark:bg-slate-950 dark:text-slate-200">
                <input
                    type="checkbox"
                    className="h-5 w-5 accent-violet-600"
                    checked={value.showCardName}
                    disabled={disabled || value.cardBack === null}
                    onChange={(event) => onChange({ showCardName: event.target.checked })}
                />
                {t("streamer.panel.showCardName")}
            </label>
        </div>
    );
}

// ---------------------------------------------------------------- defaults

const DEFAULT_SCREEN: ScreenFieldValues = {
    theme: "oyun-gecesi",
    camera: "none",
    cameraSize: "m",
    clock: null,
    cardBack: null,
    showCardName: false,
};

function initialForm(
    channels: StreamerPanelChannel[],
    categories: Record<CreateSessionInput["language"], StreamerPanelCategory[]>,
    last: CreateSessionInput | null,
    defaultLanguage: CreateSessionInput["language"],
    cardBacks: CardBackOption[]
): CreateSessionInput {
    const platforms = channels.map((channel) => channel.platform);
    const platform = last && platforms.includes(last.platform) ? last.platform : (platforms[0] ?? "twitch");
    const language = last?.language ?? defaultLanguage;
    const known = flatIds(categories[language]);
    const kept = last ? last.categoryIds.filter((id) => known.includes(id)) : [];
    const cardBack = last?.cardBack && cardBacks.some((option) => option.itemId === last.cardBack?.itemId) ? last.cardBack : null;
    return {
        platform,
        language,
        categoryIds: kept.length > 0 ? kept : known.slice(0, MAX_STREAM_CATEGORIES),
        difficulties: last?.difficulties.length ? [...last.difficulties] : [1, 2, 3],
        duration: last?.duration ?? STREAM_ROUND_DURATION.default,
        tolerance: last?.tolerance ?? "normal",
        theme: last?.theme ?? DEFAULT_SCREEN.theme,
        camera: last?.camera ?? DEFAULT_SCREEN.camera,
        cameraSize: last?.cameraSize ?? DEFAULT_SCREEN.cameraSize,
        clock: last ? last.clock : DEFAULT_SCREEN.clock,
        cardBack,
        showCardName: cardBack ? (last?.showCardName ?? false) : false,
    };
}

// ---------------------------------------------------------------- the form

export interface StreamerSetupFormProps {
    channels: StreamerPanelChannel[];
    categories: Record<CreateSessionInput["language"], StreamerPanelCategory[]>;
    lastSettings: CreateSessionInput | null;
    cardBacks: CardBackOption[];
    defaultLanguage: CreateSessionInput["language"];
    onCreated: (created: CreateStreamSessionResponse) => void;
    /** Another tab opened a session first: the caller reloads the current one. */
    onAlreadyActive: () => void;
}

export function StreamerSetupForm({
    channels,
    categories,
    lastSettings,
    cardBacks,
    defaultLanguage,
    onCreated,
    onAlreadyActive,
}: StreamerSetupFormProps) {
    const { t, locale } = useI18n();
    const [form, setForm] = useState<CreateSessionInput>(() => initialForm(channels, categories, lastSettings, defaultLanguage, cardBacks));
    const [busy, setBusy] = useState(false);
    const [error, setError] = useState<string | null>(null);

    const list = categories[form.language];
    const allIds = flatIds(list);
    const atLimit = form.categoryIds.length >= MAX_STREAM_CATEGORIES;
    const durations = (DURATION_CHOICES as readonly number[]).includes(form.duration)
        ? [...DURATION_CHOICES]
        : [...DURATION_CHOICES, form.duration].sort((a, b) => a - b);

    const update = (patch: Partial<CreateSessionInput>) => {
        setError(null);
        setForm((current) => ({ ...current, ...patch }));
    };

    const setLanguage = (language: CreateSessionInput["language"]) => {
        if (language === form.language) return;
        update({ language, categoryIds: flatIds(categories[language]).slice(0, MAX_STREAM_CATEGORIES) });
    };

    const toggleCategory = (id: number) => {
        const selected = form.categoryIds.includes(id);
        if (!selected && atLimit) return;
        update({ categoryIds: selected ? form.categoryIds.filter((entry) => entry !== id) : [...form.categoryIds, id] });
    };

    const toggleDifficulty = (value: 1 | 2 | 3) => {
        const selected = form.difficulties.includes(value);
        const next = selected ? form.difficulties.filter((entry) => entry !== value) : [...form.difficulties, value].sort();
        update({ difficulties: next });
    };

    const updateScreen = (patch: ScreenSettingsPatch) => {
        const next: Partial<CreateSessionInput> = { ...patch };
        // The card name belongs to a card back; without one there is nothing to name.
        if (patch.cardBack === null) next.showCardName = false;
        update(next);
    };

    const submit = async () => {
        if (form.categoryIds.length === 0) {
            setError(t("streamer.panel.categoryRequired"));
            return;
        }
        if (form.difficulties.length === 0) {
            setError(t("streamer.panel.difficultyRequired"));
            return;
        }
        setBusy(true);
        setError(null);
        await runRequest(
            async () => {
                const response = await fetch("/api/streamer/sessions", {
                    method: "POST",
                    headers: { "content-type": "application/json" },
                    body: JSON.stringify(form),
                });
                const body: unknown = await response.json().catch(() => null);
                if (response.status !== 201) throw body ?? {};
                return body as CreateStreamSessionResponse;
            },
            {
                apply: onCreated,
                fail: (failure) => {
                    const code = failure && typeof failure === "object" ? (failure as { code?: unknown }).code : undefined;
                    if (code === PlayerErrorCode.STREAMER_SESSION_ACTIVE) {
                        onAlreadyActive();
                        return;
                    }
                    setError(resolveApiErrorMessage(locale, failure, t("streamer.panel.createFailed")));
                },
                settle: () => setBusy(false),
            }
        );
    };

    const chip = (id: number, name: string, root: boolean) => {
        const selected = form.categoryIds.includes(id);
        return (
            <button
                key={id}
                type="button"
                aria-pressed={selected}
                disabled={!selected && atLimit}
                onClick={() => toggleCategory(id)}
                className={`${toggleClass(selected)} inline-flex items-center gap-1.5 ${root ? "" : "font-bold"}`}
            >
                {selected ? <Check size={14} aria-hidden="true" /> : null}
                {name}
            </button>
        );
    };

    return (
        <DashboardSection title={t("streamer.panel.setupTitle")} description={t("streamer.panel.setupHelp")}>
            <form
                data-testid="streamer-setup"
                className="space-y-6"
                onSubmit={(event) => {
                    event.preventDefault();
                    void submit();
                }}
            >
                <Field label={t("streamer.panel.channel")}>
                    <div className="flex flex-wrap gap-2">
                        {channels.map((channel) => (
                            <button
                                key={channel.platform}
                                type="button"
                                aria-pressed={form.platform === channel.platform}
                                onClick={() => update({ platform: channel.platform })}
                                className={toggleClass(form.platform === channel.platform)}
                            >
                                {channel.label} · {channel.displayName}
                            </button>
                        ))}
                    </div>
                </Field>

                <Field label={t("streamer.panel.language")}>
                    <div className="flex flex-wrap gap-2">
                        {(["tr", "en"] as const).map((language) => (
                            <button
                                key={language}
                                type="button"
                                aria-pressed={form.language === language}
                                onClick={() => setLanguage(language)}
                                className={toggleClass(form.language === language)}
                            >
                                {language === "tr" ? t("streamer.panel.languageTr") : t("streamer.panel.languageEn")}
                            </button>
                        ))}
                    </div>
                </Field>

                <Field label={t("streamer.panel.categories")}>
                    {list.length === 0 ? (
                        <p className="text-sm text-slate-600 dark:text-slate-300">{t("streamer.panel.categoriesEmpty")}</p>
                    ) : (
                        <>
                            <div className="flex flex-wrap items-center gap-3 text-xs text-slate-500 dark:text-slate-400">
                                <span className="font-bold">
                                    {t("streamer.panel.categoriesCount", { count: form.categoryIds.length, max: MAX_STREAM_CATEGORIES })}
                                </span>
                                <button
                                    type="button"
                                    onClick={() => update({ categoryIds: allIds.slice(0, MAX_STREAM_CATEGORIES) })}
                                    className="font-bold text-violet-700 underline dark:text-violet-300"
                                >
                                    {t("streamer.panel.selectAll")}
                                </button>
                                <button
                                    type="button"
                                    onClick={() => update({ categoryIds: [] })}
                                    className="font-bold text-violet-700 underline dark:text-violet-300"
                                >
                                    {t("streamer.panel.selectNone")}
                                </button>
                            </div>
                            {allIds.length > MAX_STREAM_CATEGORIES ? (
                                <p className="text-xs text-slate-500 dark:text-slate-400">
                                    {t("streamer.panel.categoriesLimit", { max: MAX_STREAM_CATEGORIES })}
                                </p>
                            ) : null}
                            <div className="max-h-80 space-y-3 overflow-y-auto pr-1">
                                {list.map((root) => (
                                    <div key={root.id} className="flex flex-wrap gap-2">
                                        {chip(root.id, root.name, true)}
                                        {root.children.map((child) => chip(child.id, child.name, false))}
                                    </div>
                                ))}
                            </div>
                        </>
                    )}
                </Field>

                <div className="grid gap-6 md:grid-cols-2">
                    <Field label={t("streamer.panel.difficulty")}>
                        <div className="flex flex-wrap gap-2">
                            {DIFFICULTIES.map((entry) => (
                                <button
                                    key={entry.value}
                                    type="button"
                                    aria-pressed={form.difficulties.includes(entry.value)}
                                    onClick={() => toggleDifficulty(entry.value)}
                                    className={toggleClass(form.difficulties.includes(entry.value))}
                                >
                                    {t(entry.label)}
                                </button>
                            ))}
                        </div>
                    </Field>
                    <Field label={t("streamer.panel.duration")}>
                        <div className="flex flex-wrap gap-2">
                            {durations.map((seconds) => (
                                <button
                                    key={seconds}
                                    type="button"
                                    aria-pressed={form.duration === seconds}
                                    onClick={() => update({ duration: seconds })}
                                    className={toggleClass(form.duration === seconds)}
                                >
                                    {t("streamer.panel.seconds", { count: seconds })}
                                </button>
                            ))}
                        </div>
                    </Field>
                </div>

                <Field label={t("streamer.panel.tolerance")}>
                    <div className="grid gap-2 sm:grid-cols-2">
                        {(["normal", "strict"] as const).map((tolerance) => (
                            <button
                                key={tolerance}
                                type="button"
                                aria-pressed={form.tolerance === tolerance}
                                onClick={() => update({ tolerance })}
                                className={`${toggleClass(form.tolerance === tolerance)} py-2 text-left`}
                            >
                                <span className="block">
                                    {tolerance === "normal" ? t("streamer.panel.toleranceNormal") : t("streamer.panel.toleranceStrict")}
                                </span>
                                <span className="block text-xs font-semibold opacity-80">
                                    {tolerance === "normal" ? t("streamer.panel.toleranceNormalHelp") : t("streamer.panel.toleranceStrictHelp")}
                                </span>
                            </button>
                        ))}
                    </div>
                </Field>

                <div className="space-y-3 rounded-2xl border border-slate-200 bg-slate-50/80 p-4 dark:border-slate-700 dark:bg-slate-900/60">
                    <div>
                        <p className="text-sm font-black text-slate-800 dark:text-slate-100">{t("streamer.panel.screenTitle")}</p>
                        <p className="text-xs text-slate-500 dark:text-slate-400">{t("streamer.panel.screenHelp")}</p>
                    </div>
                    <ScreenSettingsFields value={form} cardBacks={cardBacks} onChange={updateScreen} />
                </div>

                {error ? (
                    <p role="alert" className="text-sm font-semibold text-rose-700 dark:text-rose-300">
                        {error}
                    </p>
                ) : null}
                <button
                    type="submit"
                    disabled={busy || channels.length === 0}
                    className="min-h-14 w-full rounded-2xl bg-violet-600 px-6 text-lg font-black text-white shadow-lg shadow-violet-600/20 transition hover:bg-violet-700 disabled:cursor-not-allowed disabled:opacity-60"
                >
                    {busy ? t("streamer.panel.creating") : t("streamer.panel.create")}
                </button>
            </form>
        </DashboardSection>
    );
}
