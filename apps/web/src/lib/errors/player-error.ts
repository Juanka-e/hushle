import { DEFAULT_LOCALE, type AppLocale } from "@/lib/i18n/config";
import { dictionaries, translate, type TranslationKey } from "@/lib/i18n/dictionaries";
import {
    PlayerErrorCode,
    type PlayerErrorParams,
} from "./player-error-codes";

export { PlayerErrorCode, type PlayerErrorParams } from "./player-error-codes";

// Compile-time guarantees: every code has a Turkish and an English dictionary entry.
type PlayerErrorKey = `errors.${PlayerErrorCode}`;
const everyCodeHasTurkishText: PlayerErrorKey extends TranslationKey ? true : never = true;
const everyCodeHasEnglishText: PlayerErrorCode extends keyof (typeof dictionaries)["en"]["errors"]
    ? true
    : never = true;
void everyCodeHasTurkishText;
void everyCodeHasEnglishText;

/** JSON body of a player-facing HTTP error: `error` stays readable for clients that ignore `code`. */
export interface PlayerErrorBody {
    error: string;
    code: PlayerErrorCode;
    params?: PlayerErrorParams;
}

function hasParams(params: PlayerErrorParams | undefined): params is PlayerErrorParams {
    return Boolean(params) && Object.keys(params as object).length > 0;
}

/** Localized text for a code; the server sends the default (Turkish) locale. */
export function getPlayerErrorMessage(
    code: PlayerErrorCode,
    params?: PlayerErrorParams,
    locale: AppLocale = DEFAULT_LOCALE
): string {
    return translate(locale, `errors.${code}` as PlayerErrorKey, params);
}

export function playerError(code: PlayerErrorCode, params?: PlayerErrorParams): PlayerErrorBody {
    return hasParams(params)
        ? { error: getPlayerErrorMessage(code, params), code, params: { ...params } }
        : { error: getPlayerErrorMessage(code), code };
}

interface ZodLikeError {
    issues: ReadonlyArray<{ path: ReadonlyArray<PropertyKey> }>;
}

/**
 * Maps a validation failure to a code by the first failing top-level field. Zod's own messages are
 * English and were never meant for players, so unknown fields fall back to a generic code.
 */
export function playerErrorFromValidation(
    error: ZodLikeError,
    fieldCodes: Readonly<Partial<Record<string, PlayerErrorCode>>>,
    fallback: PlayerErrorCode = PlayerErrorCode.INVALID_REQUEST
): PlayerErrorBody {
    const field = error.issues[0]?.path[0];
    const code =
        typeof field === "string" && Object.prototype.hasOwnProperty.call(fieldCodes, field)
            ? fieldCodes[field]
            : undefined;
    return playerError(code ?? fallback);
}
