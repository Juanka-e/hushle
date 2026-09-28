import { expect, test } from "@playwright/test";

test.describe("payment webhook surface", () => {
    test("remains provider-authenticated and fail-closed without browser controls", async ({ request }) => {
        const knownProvider = await request.post("/api/payments/webhooks/stripe", {
            data: "{}",
            headers: { "content-type": "application/json" },
        });
        expect(knownProvider.status()).toBe(404);
        expect(await knownProvider.json()).toEqual({ error: "Webhook endpoint not found." });
        expect(knownProvider.headers()["x-request-id"]).toMatch(/^[a-zA-Z0-9_-]{8,128}$/);
        expect(knownProvider.headers()["cache-control"]).toBe("no-store");

        const disabledIyzico = await request.post("/api/payments/webhooks/iyzico", {
            data: "{}",
            headers: { "content-type": "application/json" },
        });
        expect(disabledIyzico.status()).toBe(404);
        expect(await disabledIyzico.json()).toEqual({ error: "Webhook endpoint not found." });

        const unknownProvider = await request.post("/api/payments/webhooks/not-a-provider", {
            data: "{}",
            headers: { "content-type": "application/json" },
        });
        expect(unknownProvider.status()).toBe(404);
    });
});
