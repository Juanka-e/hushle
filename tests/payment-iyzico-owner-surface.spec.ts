import { expect, test } from "@playwright/test";

test.describe("Iyzico owner checkout surface", () => {
    test("keeps session owner-only and disabled callback fail-closed", async ({ request }) => {
        const browserOrigin = process.env.SMOKE_BASE_URL ?? "http://127.0.0.1:3201";
        const anonymousSession = await request.post("/api/payments/checkout/iyzico/session", {
            data: {},
            headers: { "content-type": "application/json", origin: browserOrigin },
        });
        expect(anonymousSession.status()).toBe(401);
        expect(anonymousSession.headers()["cache-control"]).toBe("no-store");

        const disabledCallback = await request.post(
            "/api/payments/callback/iyzico?order=11111111-2222-4333-8444-555555555555",
            {
                form: { token: "sandbox-disabled-token" },
            }
        );
        expect(disabledCallback.status()).toBe(404);
        expect(disabledCallback.headers()["cache-control"]).toBe("no-store");
        expect(await disabledCallback.text()).not.toContain("sandbox-disabled-token");

        const unsupportedMethod = await request.get(
            "/api/payments/callback/iyzico?order=11111111-2222-4333-8444-555555555555"
        );
        expect(unsupportedMethod.status()).toBe(405);
    });
});
