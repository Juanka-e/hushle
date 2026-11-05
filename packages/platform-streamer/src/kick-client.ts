import {
    platformRequest,
    requireString,
    StreamerPlatformError,
    tokenSetFromResponse,
    type FetchLike,
    type PlatformIdentity,
    type StreamerPlatformClient,
    type TokenSet,
} from "./platform-client";
import { StreamerConfigError } from "./token-crypto";

// Kick: authorization code + PKCE S256 and a client secret, both on the token call
// (docs/stream/platform-oauth-arastirmasi.md §2). Identity needs users + channels.

const AUTHORIZE_URL = "https://id.kick.com/oauth/authorize";
const TOKEN_URL = "https://id.kick.com/oauth/token";
const REVOKE_URL = "https://id.kick.com/oauth/revoke";
const USERS_URL = "https://api.kick.com/public/v1/users";
const CHANNELS_URL = "https://api.kick.com/public/v1/channels";
const SCOPES = ["user:read", "channel:read"] as const;

export interface KickEnvironment {
    STREAMER_KICK_CLIENT_ID?: string;
    STREAMER_KICK_CLIENT_SECRET?: string;
}

export function createKickPlatformClient(env: KickEnvironment, fetchImpl: FetchLike = fetch): StreamerPlatformClient {
    const clientId = env.STREAMER_KICK_CLIENT_ID?.trim();
    const clientSecret = env.STREAMER_KICK_CLIENT_SECRET?.trim();
    if (!clientId || !clientSecret) {
        throw new StreamerConfigError("STREAMER_KICK_CLIENT_ID and STREAMER_KICK_CLIENT_SECRET are required");
    }

    const tokenRequest = async (operation: string, classify: "exchange" | "refresh", form: Record<string, string>): Promise<TokenSet> => {
        const payload = await platformRequest(fetchImpl, {
            platform: "kick",
            operation,
            classify,
            url: TOKEN_URL,
            form: { client_id: clientId, client_secret: clientSecret, ...form },
        });
        return tokenSetFromResponse("kick", operation, payload);
    };

    const firstRow = async (operation: string, url: string, accessToken: string): Promise<Record<string, unknown>> => {
        const payload = (await platformRequest(fetchImpl, {
            platform: "kick",
            operation,
            url,
            headers: { authorization: `Bearer ${accessToken}` },
        })) as { data?: unknown };
        const row = Array.isArray(payload.data) ? (payload.data[0] as Record<string, unknown> | undefined) : undefined;
        if (!row) throw new StreamerPlatformError("kick", operation, "unexpected", 200);
        return row;
    };

    return {
        platform: "kick",
        isFake: false,
        requiresPkce: true,
        scopes: SCOPES,
        authorizationUrl({ state, redirectUri, codeChallenge }) {
            if (!codeChallenge) throw new Error("kick authorization needs a PKCE codeChallenge");
            const url = new URL(AUTHORIZE_URL);
            url.searchParams.set("client_id", clientId);
            url.searchParams.set("response_type", "code");
            url.searchParams.set("redirect_uri", redirectUri);
            url.searchParams.set("state", state);
            url.searchParams.set("scope", SCOPES.join(" "));
            url.searchParams.set("code_challenge", codeChallenge);
            url.searchParams.set("code_challenge_method", "S256");
            return url.toString();
        },
        exchangeCode({ code, redirectUri, codeVerifier }) {
            return tokenRequest("exchange", "exchange", {
                grant_type: "authorization_code",
                code,
                redirect_uri: redirectUri,
                code_verifier: codeVerifier ?? "",
            });
        },
        refresh(refreshToken) {
            return tokenRequest("refresh", "refresh", { grant_type: "refresh_token", refresh_token: refreshToken });
        },
        async revoke(token, hint) {
            await platformRequest(fetchImpl, {
                platform: "kick",
                operation: "revoke",
                url: REVOKE_URL,
                form: { token, token_hint_type: hint },
                expectJson: false,
            });
        },
        async fetchIdentity(accessToken): Promise<PlatformIdentity> {
            const user = await firstRow("identity", USERS_URL, accessToken);
            const channel = await firstRow("identity", CHANNELS_URL, accessToken);
            const id = requireString(user.user_id);
            const slug = requireString(channel.slug);
            if (!id || !slug) throw new StreamerPlatformError("kick", "identity", "unexpected", 200);
            return {
                platformUserId: id,
                login: slug,
                displayName: requireString(user.name) ?? slug,
                avatarUrl: requireString(user.profile_picture),
                channelUrl: `https://kick.com/${slug}`,
            };
        },
    };
}
