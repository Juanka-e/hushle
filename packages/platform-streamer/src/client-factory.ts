import { createFakePlatformClient } from "./fake-client";
import { isFakePlatformEnabled } from "./fake-gate";
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
