import assert from "node:assert/strict";
import {
    createStreamerPlatformClient,
    createFakePlatformClient,
    createKickPlatformClient,
    createTwitchPlatformClient,
    isFakePlatformEnabled,
    PLATFORM_LABELS,
    STREAMER_PLATFORMS,
    StreamerConfigError,
    StreamerPlatformError,
    type StreamerPlatformClient,
} from "@hushle/platform-streamer";

// Twitch / Kick / Fake OAuth clients (spec kararlar 6–8). Network is a recording stub.

let count = 0;
async function test(name: string, run: () => Promise<void> | void): Promise<void> {
    await run();
    count += 1;
    console.log(`PASS ${name}`);
}

interface RecordedRequest {
    url: string;
    method: string;
    headers: Record<string, string>;
    body: string | null;
}

interface StubResponse {
    status: number;
    body: unknown;
}

function stubFetch(responses: Array<StubResponse | Error>) {
    const requests: RecordedRequest[] = [];
    const fetchImpl: typeof fetch = async (input, init) => {
        const headers: Record<string, string> = {};
        new Headers(init?.headers).forEach((value, key) => {
            headers[key.toLowerCase()] = value;
        });
        requests.push({
            url: String(input),
            method: init?.method ?? "GET",
            headers,
            body: typeof init?.body === "string" ? init.body : init?.body ? String(init.body) : null,
        });
        const next = responses.shift();
        if (!next) throw new Error("stub exhausted");
        if (next instanceof Error) throw next;
        return new Response(typeof next.body === "string" ? next.body : JSON.stringify(next.body), {
            status: next.status,
            headers: { "content-type": "application/json" },
        });
    };
    return { fetchImpl, requests };
}

const twitchEnv = { STREAMER_TWITCH_CLIENT_ID: "tw-client", STREAMER_TWITCH_CLIENT_SECRET: "tw-secret-value" };
const kickEnv = { STREAMER_KICK_CLIENT_ID: "kick-client", STREAMER_KICK_CLIENT_SECRET: "kick-secret-value" };
const redirectUri = "https://hushle.example/api/streamer/connect/twitch/callback";

async function expectPlatformError(run: () => Promise<unknown>, kind: StreamerPlatformError["kind"], status?: number) {
    try {
        await run();
        assert.fail(`expected ${kind}`);
    } catch (error) {
        assert.ok(error instanceof StreamerPlatformError, `expected StreamerPlatformError, got ${String(error)}`);
        assert.equal(error.kind, kind);
        if (status !== undefined) assert.equal(error.status, status);
        return error;
    }
    return null;
}

async function main(): Promise<void> {
await test("platform constants", () => {
    assert.deepEqual([...STREAMER_PLATFORMS], ["twitch", "kick"]);
    assert.deepEqual(PLATFORM_LABELS, { twitch: "Twitch", kick: "Kick" });
});

await test("twitch authorization url: code flow, no scopes, forced verify, state carried", () => {
    const client = createTwitchPlatformClient(twitchEnv, fetch);
    assert.equal(client.requiresPkce, false);
    assert.deepEqual([...client.scopes], []);
    const url = new URL(client.authorizationUrl({ state: "abc123", redirectUri }));
    assert.equal(url.origin + url.pathname, "https://id.twitch.tv/oauth2/authorize");
    assert.equal(url.searchParams.get("response_type"), "code");
    assert.equal(url.searchParams.get("client_id"), "tw-client");
    assert.equal(url.searchParams.get("redirect_uri"), redirectUri);
    assert.equal(url.searchParams.get("state"), "abc123");
    assert.equal(url.searchParams.get("force_verify"), "true");
    assert.equal(url.searchParams.get("scope"), "");
});

await test("twitch exchangeCode posts the form and maps the token set", async () => {
    const { fetchImpl, requests } = stubFetch([
        { status: 200, body: { access_token: "acc", refresh_token: "ref", expires_in: 14124, scope: [], token_type: "bearer" } },
    ]);
    const client = createTwitchPlatformClient(twitchEnv, fetchImpl);
    const before = Date.now();
    const tokens = await client.exchangeCode({ code: "the-code", redirectUri });
    assert.equal(requests[0].url, "https://id.twitch.tv/oauth2/token");
    assert.equal(requests[0].method, "POST");
    assert.equal(requests[0].headers["content-type"], "application/x-www-form-urlencoded");
    const form = new URLSearchParams(requests[0].body ?? "");
    assert.equal(form.get("grant_type"), "authorization_code");
    assert.equal(form.get("client_id"), "tw-client");
    assert.equal(form.get("client_secret"), "tw-secret-value");
    assert.equal(form.get("code"), "the-code");
    assert.equal(form.get("redirect_uri"), redirectUri);
    assert.equal(tokens.accessToken, "acc");
    assert.equal(tokens.refreshToken, "ref");
    assert.deepEqual(tokens.scopes, []);
    assert.ok(tokens.expiresAt && tokens.expiresAt.getTime() >= before + 14124_000 - 50);
});

await test("twitch refresh and revoke use the documented forms", async () => {
    const { fetchImpl, requests } = stubFetch([
        { status: 200, body: { access_token: "acc2", refresh_token: "ref2", expires_in: 3600, scope: ["user:read:chat"] } },
        { status: 200, body: "" },
    ]);
    const client = createTwitchPlatformClient(twitchEnv, fetchImpl);
    const tokens = await client.refresh("ref");
    assert.equal(tokens.refreshToken, "ref2");
    assert.deepEqual(tokens.scopes, ["user:read:chat"]);
    const refreshForm = new URLSearchParams(requests[0].body ?? "");
    assert.equal(refreshForm.get("grant_type"), "refresh_token");
    assert.equal(refreshForm.get("refresh_token"), "ref");
    await client.revoke("acc2", "access_token");
    assert.equal(requests[1].url, "https://id.twitch.tv/oauth2/revoke");
    const revokeForm = new URLSearchParams(requests[1].body ?? "");
    assert.equal(revokeForm.get("client_id"), "tw-client");
    assert.equal(revokeForm.get("token"), "acc2");
});

await test("twitch identity sends both headers and maps the user", async () => {
    const { fetchImpl, requests } = stubFetch([
        {
            status: 200,
            body: {
                data: [
                    {
                        id: "141981764",
                        login: "denizoynuyor",
                        display_name: "DenizOynuyor",
                        profile_image_url: "https://static-cdn.jtvnw.net/x.png",
                        email: "never-used@example.com",
                    },
                ],
            },
        },
    ]);
    const client = createTwitchPlatformClient(twitchEnv, fetchImpl);
    const identity = await client.fetchIdentity("acc");
    assert.equal(requests[0].url, "https://api.twitch.tv/helix/users");
    assert.equal(requests[0].headers.authorization, "Bearer acc");
    assert.equal(requests[0].headers["client-id"], "tw-client");
    assert.deepEqual(identity, {
        platformUserId: "141981764",
        login: "denizoynuyor",
        displayName: "DenizOynuyor",
        avatarUrl: "https://static-cdn.jtvnw.net/x.png",
        channelUrl: "https://twitch.tv/denizoynuyor",
    });
});

await test("twitch validate reads the validate endpoint with the OAuth scheme", async () => {
    const { fetchImpl, requests } = stubFetch([
        { status: 200, body: { client_id: "tw-client", login: "denizoynuyor", user_id: "1", expires_in: 5000, scopes: [] } },
        { status: 401, body: { status: 401, message: "invalid access token" } },
    ]);
    const client = createTwitchPlatformClient(twitchEnv, fetchImpl);
    assert.ok(client.validate);
    assert.deepEqual(await client.validate("acc"), { ok: true, expiresInSeconds: 5000 });
    assert.equal(requests[0].headers.authorization, "OAuth acc");
    assert.deepEqual(await client.validate("acc"), { ok: false, expiresInSeconds: null });
});

await test("errors map to kinds and never carry the response body", async () => {
    const { fetchImpl } = stubFetch([
        { status: 401, body: { message: "SECRET_BODY_401" } },
        { status: 400, body: { error: "invalid_grant", message: "SECRET_BODY_400" } },
        { status: 429, body: "SECRET_BODY_429" },
        new Error("SECRET_NETWORK"),
        { status: 500, body: "SECRET_BODY_500" },
        { status: 200, body: { data: [] } },
    ]);
    const client = createTwitchPlatformClient(twitchEnv, fetchImpl);
    const unauthorized = await expectPlatformError(() => client.fetchIdentity("acc"), "unauthorized", 401);
    const invalid = await expectPlatformError(() => client.refresh("ref"), "invalid_grant", 400);
    const limited = await expectPlatformError(() => client.fetchIdentity("acc"), "rate_limited", 429);
    const network = await expectPlatformError(() => client.fetchIdentity("acc"), "network");
    const unexpected = await expectPlatformError(() => client.fetchIdentity("acc"), "unexpected", 500);
    const empty = await expectPlatformError(() => client.fetchIdentity("acc"), "unexpected", 200);
    for (const error of [unauthorized, invalid, limited, network, unexpected, empty]) {
        assert.ok(error);
        assert.ok(!/SECRET/.test(error.message), error.message);
        assert.match(error.message, /^twitch \w+ failed \(/);
    }
});

await test("kick authorization url carries PKCE S256 and the two read scopes", () => {
    const client = createKickPlatformClient(kickEnv, fetch);
    assert.equal(client.requiresPkce, true);
    assert.deepEqual([...client.scopes], ["user:read", "channel:read"]);
    const url = new URL(client.authorizationUrl({ state: "s1", redirectUri, codeChallenge: "challenge-value" }));
    assert.equal(url.origin + url.pathname, "https://id.kick.com/oauth/authorize");
    assert.equal(url.searchParams.get("client_id"), "kick-client");
    assert.equal(url.searchParams.get("response_type"), "code");
    assert.equal(url.searchParams.get("scope"), "user:read channel:read");
    assert.equal(url.searchParams.get("code_challenge"), "challenge-value");
    assert.equal(url.searchParams.get("code_challenge_method"), "S256");
    assert.equal(url.searchParams.get("state"), "s1");
    assert.throws(() => client.authorizationUrl({ state: "s1", redirectUri }), /codeChallenge/);
});

await test("kick exchangeCode sends verifier and secret; identity merges users and channels", async () => {
    const { fetchImpl, requests } = stubFetch([
        { status: 200, body: { access_token: "kacc", refresh_token: "kref", expires_in: 3600, scope: "user:read channel:read", token_type: "Bearer" } },
        { status: 200, body: { data: [{ user_id: 987, name: "Deniz", email: "x@example.com", profile_picture: "https://files.kick.com/p.png" }] } },
        { status: 200, body: { data: [{ broadcaster_user_id: 987, slug: "deniz-oynuyor", channel_description: "", banner_picture: "", stream: { is_live: false } }] } },
    ]);
    const client = createKickPlatformClient(kickEnv, fetchImpl);
    const tokens = await client.exchangeCode({ code: "kcode", redirectUri, codeVerifier: "verifier-value" });
    assert.equal(requests[0].url, "https://id.kick.com/oauth/token");
    const form = new URLSearchParams(requests[0].body ?? "");
    assert.equal(form.get("code_verifier"), "verifier-value");
    assert.equal(form.get("client_secret"), "kick-secret-value");
    assert.equal(form.get("grant_type"), "authorization_code");
    assert.deepEqual(tokens.scopes, ["user:read", "channel:read"]);
    const identity = await client.fetchIdentity("kacc");
    assert.equal(requests[1].url, "https://api.kick.com/public/v1/users");
    assert.equal(requests[1].headers.authorization, "Bearer kacc");
    assert.equal(requests[2].url, "https://api.kick.com/public/v1/channels");
    assert.deepEqual(identity, {
        platformUserId: "987",
        login: "deniz-oynuyor",
        displayName: "Deniz",
        avatarUrl: "https://files.kick.com/p.png",
        channelUrl: "https://kick.com/deniz-oynuyor",
    });
});

await test("kick refresh 400 is invalid_grant and revoke sends the hint in query and body", async () => {
    const { fetchImpl, requests } = stubFetch([
        { status: 400, body: { error: "invalid_grant" } },
        { status: 200, body: "" },
    ]);
    const client = createKickPlatformClient(kickEnv, fetchImpl);
    await expectPlatformError(() => client.refresh("kref"), "invalid_grant", 400);
    await client.revoke("kref", "refresh_token");
    const revokeUrl = new URL(requests[1].url);
    assert.equal(revokeUrl.origin + revokeUrl.pathname, "https://id.kick.com/oauth/revoke");
    assert.equal(revokeUrl.searchParams.get("token"), "kref");
    assert.equal(revokeUrl.searchParams.get("token_hint_type"), "refresh_token");
    const form = new URLSearchParams(requests[1].body ?? "");
    assert.equal(form.get("token"), "kref");
    assert.equal(form.get("token_hint_type"), "refresh_token");
});

await test("review 7: a 400 on refresh without error=invalid_grant is unexpected, not invalid_grant", async () => {
    const { fetchImpl } = stubFetch([
        { status: 400, body: { error: "invalid_client", message: "SECRET" } },
        { status: 400, body: { error: "invalid_request" } },
    ]);
    const client = createTwitchPlatformClient(twitchEnv, fetchImpl);
    await expectPlatformError(() => client.refresh("ref"), "unexpected", 400);
    await expectPlatformError(() => client.exchangeCode({ code: "c", redirectUri }), "unexpected", 400);
});

await test("factory: fake only outside production with the flag; real clients need credentials", () => {
    assert.equal(isFakePlatformEnabled({ STREAMER_FAKE_PLATFORM: "1", NODE_ENV: "test" }), true);
    assert.equal(isFakePlatformEnabled({ STREAMER_FAKE_PLATFORM: "1", NODE_ENV: "production" }), false);
    assert.equal(isFakePlatformEnabled({ NODE_ENV: "test" }), false);
    assert.equal(isFakePlatformEnabled({ STREAMER_FAKE_PLATFORM: "1", NODE_ENV: "production", HUSHLE_E2E_SMOKE: "1" }), true, "the Playwright smoke server runs a production build");
    assert.equal(isFakePlatformEnabled({ NODE_ENV: "production", HUSHLE_E2E_SMOKE: "1" }), false, "the smoke marker alone enables nothing");
    const fake = createStreamerPlatformClient("twitch", { STREAMER_FAKE_PLATFORM: "1", NODE_ENV: "test" });
    assert.equal(fake.platform, "twitch");
    assert.equal(fake.isFake, true);
    assert.throws(
        () => createStreamerPlatformClient("twitch", { STREAMER_FAKE_PLATFORM: "1", NODE_ENV: "production" }),
        StreamerConfigError
    );
    assert.throws(() => createStreamerPlatformClient("kick", { NODE_ENV: "production", ...twitchEnv }), StreamerConfigError);
    const real: StreamerPlatformClient = createStreamerPlatformClient("kick", { NODE_ENV: "production", ...kickEnv });
    assert.equal(real.platform, "kick");
    assert.equal(real.isFake, false);
});

await test("fake client roundtrip and failure hooks", async () => {
    const fake = createFakePlatformClient("kick");
    const url = new URL(fake.authorizationUrl({ state: "st", redirectUri, codeChallenge: "c" }), "https://hushle.example");
    assert.equal(url.pathname, "/api/streamer/connect/fake/authorize");
    assert.equal(url.searchParams.get("platform"), "kick");
    assert.equal(url.searchParams.get("state"), "st");
    assert.equal(url.searchParams.get("redirect_uri"), redirectUri);
    const tokens = await fake.exchangeCode({ code: "fake-code-deniz", redirectUri, codeVerifier: "v" });
    assert.match(tokens.accessToken, /^fake-access-deniz-\d+$/);
    assert.equal(tokens.refreshToken, "fake-refresh-deniz");
    assert.ok(tokens.expiresAt && tokens.expiresAt.getTime() > Date.now() + 3_500_000);
    const identity = await fake.fetchIdentity(tokens.accessToken);
    assert.equal(identity.platformUserId, "fake-deniz");
    assert.equal(identity.login, "deniz");
    assert.equal(identity.channelUrl, "https://kick.com/deniz");
    await expectPlatformError(() => fake.exchangeCode({ code: "garbage", redirectUri }), "invalid_grant");
    const refreshed = await fake.refresh("fake-refresh-deniz");
    assert.match(refreshed.accessToken, /^fake-access-deniz-\d+$/);
    await expectPlatformError(() => fake.refresh("fake-refresh-expired"), "invalid_grant");
    await expectPlatformError(() => fake.fetchIdentity("not-a-fake-token"), "unauthorized");
    await fake.revoke("fake-refresh-deniz", "refresh_token");
    assert.deepEqual(fake.revoked, ["fake-refresh-deniz"]);
});

console.log(`${count} checks passed.`);
}

main().catch((error) => {
    console.error(error);
    process.exit(1);
});
