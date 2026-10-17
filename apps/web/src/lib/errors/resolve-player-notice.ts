import type { AppLocale } from "@/lib/i18n/config";
import { isPlayerNoticeCode } from "./player-notice-codes";
import { sanitizePlayerErrorParams, translateWithParams } from "./resolve-player-error";

/** What a client received for one success notice, before it is turned into display text. */
export interface PlayerNoticeInput {
    /** Server text: the HTTP `message` field (Turkish). */
    message?: unknown;
    code?: unknown;
    params?: unknown;
}

function asRecord(value: unknown): Record<string, unknown> | null {
    return value && typeof value === "object" && !Array.isArray(value)
        ? (value as Record<string, unknown>)
        : null;
}

/**
 * Display text for a server success notice in the viewer's locale.
 * Known code: the localized dictionary text. Unknown code or none (older server): the server message.
 * No usable message: the caller's localized fallback, so a notice is never blank.
 */
export function resolvePlayerNoticeMessage(
    locale: AppLocale,
    input: PlayerNoticeInput,
    fallback: string
): string {
    if (isPlayerNoticeCode(input.code)) {
        const text = translateWithParams(
            locale,
            `notices.${input.code}`,
            sanitizePlayerErrorParams(input.params)
        );
        if (text.trim()) {
            return text;
        }
    }
    const message = typeof input.message === "string" ? input.message.trim() : "";
    return message || fallback;
}

/** A JSON success body `{ message, messageCode, messageParams }`; other fields are ignored. */
export function readApiPlayerNotice(payload: unknown): PlayerNoticeInput {
    const body = asRecord(payload);
    if (!body) return {};
    return { message: body.message, code: body.messageCode, params: body.messageParams };
}

export function resolveApiNoticeMessage(
    locale: AppLocale,
    payload: unknown,
    fallback: string
): string {
    return resolvePlayerNoticeMessage(locale, readApiPlayerNotice(payload), fallback);
}
