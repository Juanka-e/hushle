import { DEFAULT_LOCALE, type AppLocale } from "@/lib/i18n/config";
import { translate, type TranslationKey } from "@/lib/i18n/dictionaries";
import {
    PlayerErrorCode,
    isPlayerErrorCode,
    type PlayerErrorParams,
} from "./player-error-codes";

/** What a client received for one error, before it is turned into display text. */
export interface PlayerErrorInput {
    /** Server text: the first `hata` argument or the HTTP `error` field (Turkish). */
    message?: unknown;
    code?: unknown;
    params?: unknown;
    /** Set when `message` is text an operator wrote (maintenance or capacity notice). */
    custom?: unknown;
}

const PLACEHOLDER = /\{([a-zA-Z0-9_]+)\}/g;

function asRecord(value: unknown): Record<string, unknown> | null {
    return value && typeof value === "object" && !Array.isArray(value)
        ? (value as Record<string, unknown>)
        : null;
}

/** Keeps only plain string and finite number values; anything else is dropped. */
export function sanitizePlayerErrorParams(value: unknown): PlayerErrorParams | undefined {
    const record = asRecord(value);
    if (!record) return undefined;
    const params: Record<string, string | number> = Object.create(null);
    let count = 0;
    for (const [key, entry] of Object.entries(record)) {
        if (typeof entry === "string" || (typeof entry === "number" && Number.isFinite(entry))) {
            params[key] = entry;
            count += 1;
        }
    }
    return count > 0 ? params : undefined;
}

/**
 * Dictionary text for `key` filled with `params`, or "" when the template needs a param that is missing,
 * so the caller falls back to the server text instead of showing a `{placeholder}`.
 */
export function translateWithParams(
    locale: AppLocale,
    key: TranslationKey,
    params: PlayerErrorParams | undefined
): string {
    // Check the template, not the output: a param value such as a player name may contain braces.
    const required = [...translate(locale, key).matchAll(PLACEHOLDER)].map((match) => match[1]);
    const hasEveryParam = required.every(
        (name) => params !== undefined && Object.prototype.hasOwnProperty.call(params, name)
    );
    return hasEveryParam ? translate(locale, key, params) : "";
}

/**
 * Display text for a server error in the viewer's locale.
 * Known code: the localized dictionary text (operator-written notices stay as written in Turkish).
 * Unknown code: the server message. No usable message: the caller's fallback or a generic error.
 * Never returns an empty string, so a toast or error banner always has something to show.
 */
export function resolvePlayerErrorMessage(
    locale: AppLocale,
    input: PlayerErrorInput,
    fallback?: string
): string {
    const message = typeof input.message === "string" ? input.message.trim() : "";
    const generic = () =>
        (typeof fallback === "string" && fallback.trim()) ||
        translate(locale, "errors.UNKNOWN_ERROR");

    if (isPlayerErrorCode(input.code)) {
        if (input.custom === true && message && locale === DEFAULT_LOCALE) {
            return message;
        }
        const text = translateWithParams(
            locale,
            `errors.${input.code}`,
            sanitizePlayerErrorParams(input.params)
        );
        if (text.trim()) {
            return text;
        }
    }
    return message || generic();
}

/** Arguments of a `hata` socket event: `(message, { code, params, custom })`; old servers send only the message. */
export function readSocketPlayerError(message: unknown, meta?: unknown): PlayerErrorInput {
    const details = asRecord(meta);
    return {
        message,
        code: details?.code,
        params: details?.params,
        custom: details?.custom,
    };
}

/** A JSON error body `{ error, code, params }` (or a socket acknowledgement with the same fields). */
export function readApiPlayerError(payload: unknown): PlayerErrorInput {
    const body = asRecord(payload);
    if (!body) return {};
    return { message: body.error, code: body.code, params: body.params };
}

export function resolveApiErrorMessage(
    locale: AppLocale,
    payload: unknown,
    fallback?: string
): string {
    return resolvePlayerErrorMessage(locale, readApiPlayerError(payload), fallback);
}

/** True when the room the client asked for is gone, so the room page should go back home. */
export function isRoomNotFoundError(input: PlayerErrorInput): boolean {
    if (isPlayerErrorCode(input.code)) {
        return input.code === PlayerErrorCode.ROOM_NOT_FOUND;
    }
    // Servers that predate error codes only sent text.
    const message = typeof input.message === "string" ? input.message.toLocaleLowerCase("tr-TR") : "";
    return message.includes("bulunamad") || message.includes("found");
}
