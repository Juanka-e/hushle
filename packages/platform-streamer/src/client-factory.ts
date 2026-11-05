import { createFakePlatformClient } from "./fake-client";
import { createKickPlatformClient, type KickEnvironment } from "./kick-client";
import { type FetchLike, type StreamerPlatform, type StreamerPlatformClient } from "./platform-client";
import { StreamerConfigError } from "./token-crypto";
import { createTwitchPlatformClient, type TwitchEnvironment } from "./twitch-client";

export interface StreamerPlatformEnvironment extends TwitchEnvironment, KickEnvironment {
    [key: string]: string | undefined;
    NODE_ENV?: string;
    STREAMER_FAKE_PLATFORM?: string;
    HUSHLE_E2E_SMOKE?: string;
}

// The fake platform answers only outside production. The one exception is the Playwright
// smoke server, which runs a production build on 127.0.0.1 and marks itself with
// HUSHLE_E2E_SMOKE=1; the production preflight rejects both variables for real deployments.
export function isFakePlatformEnabled(env: StreamerPlatformEnvironment): boolean {
    if (env.STREAMER_FAKE_PLATFORM !== "1") return false;
    return env.NODE_ENV !== "production" || env.HUSHLE_E2E_SMOKE === "1";
}

export function isPlatformConfigured(platform: StreamerPlatform, env: StreamerPlatformEnvironment): boolean {
    if (isFakePlatformEnabled(env)) return true;
    if (platform === "twitch") return Boolean(env.STREAMER_TWITCH_CLIENT_ID?.trim() && env.STREAMER_TWITCH_CLIENT_SECRET?.trim());
    return Boolean(env.STREAMER_KICK_CLIENT_ID?.trim() && env.STREAMER_KICK_CLIENT_SECRET?.trim());
}

export function createStreamerPlatformClient(
    platform: StreamerPlatform,
    env: StreamerPlatformEnvironment,
    fetchImpl: FetchLike = fetch
): StreamerPlatformClient {
    if (env.STREAMER_FAKE_PLATFORM === "1" && !isFakePlatformEnabled(env)) {
        throw new StreamerConfigError("STREAMER_FAKE_PLATFORM must not be set in production");
    }
    if (isFakePlatformEnabled(env)) return createFakePlatformClient(platform);
    return platform === "twitch" ? createTwitchPlatformClient(env, fetchImpl) : createKickPlatformClient(env, fetchImpl);
}
