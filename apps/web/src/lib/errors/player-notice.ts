import { DEFAULT_LOCALE, type AppLocale } from "@/lib/i18n/config";
import { dictionaries, translate, type TranslationKey } from "@/lib/i18n/dictionaries";
import type { PlayerErrorParams } from "./player-error-codes";
import { PlayerNoticeCode } from "./player-notice-codes";

export { PlayerNoticeCode } from "./player-notice-codes";

// Compile-time guarantees: every code has a Turkish and an English dictionary entry.
type PlayerNoticeKey = `notices.${PlayerNoticeCode}`;
const everyNoticeHasTurkishText: PlayerNoticeKey extends TranslationKey ? true : never = true;
const everyNoticeHasEnglishText: PlayerNoticeCode extends keyof (typeof dictionaries)["en"]["notices"]
    ? true
    : never = true;
void everyNoticeHasTurkishText;
void everyNoticeHasEnglishText;

/** Fields a player-facing success body adds next to its own data: `message` stays readable for old clients. */
export interface PlayerNoticeBody {
    message: string;
    messageCode: PlayerNoticeCode;
    messageParams?: PlayerErrorParams;
}

/** Localized text for a notice code; the server sends the default (Turkish) locale. */
export function getPlayerNoticeMessage(
    code: PlayerNoticeCode,
    params?: PlayerErrorParams,
    locale: AppLocale = DEFAULT_LOCALE
): string {
    return translate(locale, `notices.${code}` as PlayerNoticeKey, params);
}

/** Spread into a success body: `NextResponse.json({ status, ...playerNotice(code) })`. */
export function playerNotice(code: PlayerNoticeCode, params?: PlayerErrorParams): PlayerNoticeBody {
    return params && Object.keys(params).length > 0
        ? { message: getPlayerNoticeMessage(code, params), messageCode: code, messageParams: { ...params } }
        : { message: getPlayerNoticeMessage(code), messageCode: code };
}
