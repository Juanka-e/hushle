// The fake-platform switch alone (`@hushle/platform-streamer/fake-gate`), for callers that must
// not load the platform clients or the connection store (and with it Prisma), such as the
// /stream page. It imports nothing; the package root re-exports it.

interface FakeGateEnvironment {
    [key: string]: string | undefined;
    NODE_ENV?: string;
    STREAMER_FAKE_PLATFORM?: string;
    HUSHLE_E2E_SMOKE?: string;
}

// The fake platform answers only outside production. The one exception is the Playwright
// smoke server, which runs a production build on 127.0.0.1 and marks itself with
// HUSHLE_E2E_SMOKE=1; the production preflight rejects both variables for real deployments.
export function isFakePlatformEnabled(env: FakeGateEnvironment): boolean {
    if (env.STREAMER_FAKE_PLATFORM !== "1") return false;
    return env.NODE_ENV !== "production" || env.HUSHLE_E2E_SMOKE === "1";
}
