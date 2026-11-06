import {
    StreamerPlatformError,
    type PlatformIdentity,
    type StreamerPlatform,
    type StreamerPlatformClient,
    type TokenSet,
} from "./platform-client";

// A platform that lives in memory: the connect flow and the e2e suite run end to end
// without reaching Twitch or Kick. Enabled only by the factory outside production.

export const FAKE_AUTHORIZE_PATH = "/api/streamer/connect/fake/authorize";
const CODE_PREFIX = "fake-code-";
const ACCESS_PREFIX = "fake-access-";
const REFRESH_PREFIX = "fake-refresh-";
const EXPIRED_REFRESH = "fake-refresh-expired";

export interface FakePlatformClient extends StreamerPlatformClient {
    readonly revoked: string[];
}

function loginFromToken(token: string, prefix: string): string | null {
    if (!token.startsWith(prefix)) return null;
    const rest = token.slice(prefix.length);
    const login = prefix === ACCESS_PREFIX ? rest.replace(/-\d+$/, "") : rest;
    return /^[a-z0-9_-]{1,25}$/.test(login) ? login : null;
}

export function createFakePlatformClient(platform: StreamerPlatform, options: { authorizeUrl?: string; now?: () => number } = {}): FakePlatformClient {
    const now = options.now ?? Date.now;
    const revoked: string[] = [];
    let issued = 0;

    const tokensFor = (login: string): TokenSet => ({
        accessToken: `${ACCESS_PREFIX}${login}-${++issued}`,
        refreshToken: `${REFRESH_PREFIX}${login}`,
        expiresAt: new Date(now() + 3_600_000),
        scopes: platform === "kick" ? ["user:read", "channel:read"] : [],
    });

    return {
        platform,
        isFake: true,
        requiresPkce: platform === "kick",
        scopes: platform === "kick" ? ["user:read", "channel:read"] : [],
        revoked,
        authorizationUrl({ state, redirectUri }) {
            const params = new URLSearchParams({ platform, state, redirect_uri: redirectUri });
            return `${options.authorizeUrl ?? FAKE_AUTHORIZE_PATH}?${params.toString()}`;
        },
        async exchangeCode({ code }) {
            const login = loginFromToken(code, CODE_PREFIX);
            if (!login) throw new StreamerPlatformError(platform, "exchange", "invalid_grant", 400);
            return tokensFor(login);
        },
        async refresh(refreshToken) {
            const login = refreshToken === EXPIRED_REFRESH ? null : loginFromToken(refreshToken, REFRESH_PREFIX);
            if (!login) throw new StreamerPlatformError(platform, "refresh", "invalid_grant", 400);
            return tokensFor(login);
        },
        async revoke(token) {
            revoked.push(token);
        },
        async fetchIdentity(accessToken): Promise<PlatformIdentity> {
            const login = loginFromToken(accessToken, ACCESS_PREFIX);
            if (!login) throw new StreamerPlatformError(platform, "identity", "unauthorized", 401);
            return {
                platformUserId: `fake-${login}`,
                login,
                displayName: login.charAt(0).toUpperCase() + login.slice(1),
                avatarUrl: null,
                channelUrl: platform === "kick" ? `https://kick.com/${login}` : `https://twitch.tv/${login}`,
            };
        },
        async validate(accessToken) {
            return { ok: loginFromToken(accessToken, ACCESS_PREFIX) !== null, expiresInSeconds: 3600 };
        },
    };
}
