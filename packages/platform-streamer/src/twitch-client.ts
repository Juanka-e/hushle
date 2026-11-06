import {
    platformRequest,
    requireString,
    StreamerPlatformError,
    tokenSetFromResponse,
    type FetchLike,
    type JsonRequest,
    type PlatformHttpOptions,
    type PlatformIdentity,
    type StreamerPlatformClient,
    type TokenSet,
} from "./platform-client";
import { StreamerConfigError } from "./token-crypto";

// Twitch: authorization code grant with client secret; identity needs no scope
// (docs/stream/platform-oauth-arastirmasi.md §1). Validation is the hourly duty Twitch audits.

const AUTHORIZE_URL = "https://id.twitch.tv/oauth2/authorize";
const TOKEN_URL = "https://id.twitch.tv/oauth2/token";
const REVOKE_URL = "https://id.twitch.tv/oauth2/revoke";
const VALIDATE_URL = "https://id.twitch.tv/oauth2/validate";
const USERS_URL = "https://api.twitch.tv/helix/users";

export interface TwitchEnvironment {
    STREAMER_TWITCH_CLIENT_ID?: string;
    STREAMER_TWITCH_CLIENT_SECRET?: string;
}

export function createTwitchPlatformClient(env: TwitchEnvironment, fetchImpl: FetchLike = fetch, http: PlatformHttpOptions = {}): StreamerPlatformClient {
    const clientId = env.STREAMER_TWITCH_CLIENT_ID?.trim();
    const clientSecret = env.STREAMER_TWITCH_CLIENT_SECRET?.trim();
    if (!clientId || !clientSecret) {
        throw new StreamerConfigError("STREAMER_TWITCH_CLIENT_ID and STREAMER_TWITCH_CLIENT_SECRET are required");
    }

    // Every call is bounded (PLATFORM_REQUEST_TIMEOUT_MS unless the caller says otherwise).
    const call = (input: JsonRequest) => platformRequest(fetchImpl, input, http);

    const tokenRequest = async (operation: string, classify: "exchange" | "refresh", form: Record<string, string>): Promise<TokenSet> => {
        const payload = await call({
            platform: "twitch",
            operation,
            classify,
            url: TOKEN_URL,
            form: { client_id: clientId, client_secret: clientSecret, ...form },
        });
        return tokenSetFromResponse("twitch", operation, payload);
    };

    return {
        platform: "twitch",
        isFake: false,
        requiresPkce: false,
        scopes: [],
        authorizationUrl({ state, redirectUri }) {
            const url = new URL(AUTHORIZE_URL);
            url.searchParams.set("response_type", "code");
            url.searchParams.set("client_id", clientId);
            url.searchParams.set("redirect_uri", redirectUri);
            url.searchParams.set("scope", "");
            url.searchParams.set("state", state);
            url.searchParams.set("force_verify", "true");
            return url.toString();
        },
        exchangeCode({ code, redirectUri }) {
            return tokenRequest("exchange", "exchange", { grant_type: "authorization_code", code, redirect_uri: redirectUri });
        },
        refresh(refreshToken) {
            return tokenRequest("refresh", "refresh", { grant_type: "refresh_token", refresh_token: refreshToken });
        },
        async revoke(token: string) {
            await call({
                platform: "twitch",
                operation: "revoke",
                url: REVOKE_URL,
                form: { client_id: clientId, token },
                expectJson: false,
            });
        },
        async fetchIdentity(accessToken): Promise<PlatformIdentity> {
            const payload = (await call({
                platform: "twitch",
                operation: "identity",
                url: USERS_URL,
                headers: { authorization: `Bearer ${accessToken}`, "client-id": clientId },
            })) as { data?: unknown };
            const user = Array.isArray(payload.data) ? (payload.data[0] as Record<string, unknown> | undefined) : undefined;
            const id = requireString(user?.id);
            const login = requireString(user?.login);
            if (!user || !id || !login) throw new StreamerPlatformError("twitch", "identity", "unexpected", 200);
            return {
                platformUserId: id,
                login,
                displayName: requireString(user.display_name) ?? login,
                avatarUrl: requireString(user.profile_image_url),
                channelUrl: `https://twitch.tv/${login}`,
            };
        },
        async validate(accessToken) {
            try {
                const payload = (await call({
                    platform: "twitch",
                    operation: "validate",
                    url: VALIDATE_URL,
                    headers: { authorization: `OAuth ${accessToken}` },
                })) as { expires_in?: unknown };
                return { ok: true, expiresInSeconds: typeof payload.expires_in === "number" ? payload.expires_in : null };
            } catch (error) {
                if (error instanceof StreamerPlatformError && error.kind === "unauthorized") {
                    return { ok: false, expiresInSeconds: null };
                }
                throw error;
            }
        },
    };
}
