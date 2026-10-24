import { cookies } from "next/headers";
import { LOCALE_COOKIE_NAME, normalizeAppLocale, type AppLocale } from "./config";

/** The visitor's UI locale, from the same cookie the root layout reads. */
export async function getRequestLocale(): Promise<AppLocale> {
    return normalizeAppLocale((await cookies()).get(LOCALE_COOKIE_NAME)?.value);
}
