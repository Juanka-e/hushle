/**
 * Stable codes for player-facing success and status messages that the server sends in HTTP bodies as
 * `{ message, messageCode, messageParams? }`. Clients translate them through
 * `dictionaries.<locale>.notices`; `message` stays the Turkish text so older clients still show it.
 * The field is `messageCode`, not `code`, because success bodies may carry their own `code` data and
 * clients treat a `code` next to `error` as an error. Codes are part of the wire contract: add new ones
 * freely, never rename or reuse an existing one.
 */
export const PlayerNoticeCode = {
    // Registration
    REGISTRATION_COMPLETE: "REGISTRATION_COMPLETE",
    REGISTRATION_VERIFY_EMAIL: "REGISTRATION_VERIFY_EMAIL",

    // Account email and password recovery
    EMAIL_ALREADY_VERIFIED: "EMAIL_ALREADY_VERIFIED",
    VERIFICATION_EMAIL_QUEUED: "VERIFICATION_EMAIL_QUEUED",
    EMAIL_CHANGE_VERIFICATION_QUEUED: "EMAIL_CHANGE_VERIFICATION_QUEUED",
    PASSWORD_RESET_REQUESTED: "PASSWORD_RESET_REQUESTED",
} as const;

export type PlayerNoticeCode = (typeof PlayerNoticeCode)[keyof typeof PlayerNoticeCode];

export const PLAYER_NOTICE_CODES: readonly PlayerNoticeCode[] = Object.freeze(
    Object.values(PlayerNoticeCode)
);

const PLAYER_NOTICE_CODE_SET: ReadonlySet<string> = new Set(PLAYER_NOTICE_CODES);

export function isPlayerNoticeCode(value: unknown): value is PlayerNoticeCode {
    return typeof value === "string" && PLAYER_NOTICE_CODE_SET.has(value);
}
