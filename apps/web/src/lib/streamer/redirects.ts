import type { StreamerPlatform } from "@hushle/platform-streamer";

// Every connect outcome lands on the settings tab. The code is one of a fixed list, so no
// platform text and no caller-supplied URL can ride along (no open redirect).

export const STREAMER_REDIRECT_CODES = [
    "unauthenticated",
    "platform_invalid",
    "disabled",
    "platform_unavailable",
    "rate_limited",
    "state_missing",
    "state_invalid",
    "state_expired",
    "state_mismatch",
    "denied",
    "already_linked_elsewhere",
    "platform_error",
    "internal_error",
] as const;

export type StreamerRedirectCode = (typeof STREAMER_REDIRECT_CODES)[number];

export const SETTINGS_PATH = "/dashboard?tab=settings";

export function settingsRedirect(status: "linked" | "error", platform: StreamerPlatform | string, code?: StreamerRedirectCode): string {
    const params = new URLSearchParams({ streamer: status, platform: String(platform).slice(0, 16) });
    if (status === "error") params.set("code", code && (STREAMER_REDIRECT_CODES as readonly string[]).includes(code) ? code : "internal_error");
    return `${SETTINGS_PATH}&${params.toString()}`;
}
