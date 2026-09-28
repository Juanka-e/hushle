import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import {
    createShopierCustomListing,
    getPaymentProviderReadiness,
    isAllowedShopierHostedUrl,
    listShopierCustomListings,
    listShopierPaidOrdersByProduct,
    SHOPIER_API_BASE_URL,
    SHOPIER_ORDERS_PATH,
    SHOPIER_PRODUCTS_PATH,
    ShopierAdapterError,
} from "@hushle/platform-payments";

const orderId = "11111111-2222-4333-8444-555555555555";
const token = "shopier-pat-test-token-with-safe-length-123";
const request = {
    orderId,
    amountMinor: 1_197,
    currency: "TRY" as const,
    productName: "120 Coin",
    mediaUrl: "https://assets.example.test/payments/coin-pack.png",
    credentials: { personalAccessToken: token },
};

function providerProduct(overrides: Record<string, unknown> = {}): Record<string, unknown> {
    return {
        id: "689793",
        title: "120 Coin [11111111]",
        type: "digital",
        url: "https://www.shopier.com/689793",
        priceData: { currency: "TRY", price: "11.97" },
        stockStatus: "inStock",
        stockQuantity: 1,
        shippingPayer: "sellerPays",
        customListing: true,
        ...overrides,
    };
}

function providerOrder(overrides: Record<string, unknown> = {}): Record<string, unknown> {
    return {
        id: "990001",
        paymentStatus: "paid",
        dateCreated: "2026-08-10T10:00:00Z",
        currency: "TRY",
        totals: { subtotal: "11.97", shipping: "0.00", discount: "0.00", total: "11.97" },
        shippingInfo: { email: "buyer@example.test" },
        lineItems: [{
            productId: "689793",
            title: "120 Coin [11111111]",
            type: "digital",
            quantity: 1,
            price: "11.97",
            total: "11.97",
        }],
        refunds: [],
        ...overrides,
    };
}

async function expectCode(action: () => Promise<unknown>, code: string): Promise<void> {
    await assert.rejects(action, (error: unknown) => {
        assert.ok(error instanceof ShopierAdapterError);
        assert.equal(error.code, code);
        return true;
    });
}

async function run(): Promise<void> {
    let capturedUrl = "";
    let capturedBody = "";
    let capturedHeaders = new Headers();
    let capturedRedirect: RequestRedirect | undefined;
    const result = await createShopierCustomListing({
        ...request,
        fetchImpl: async (input, init) => {
            capturedUrl = String(input);
            capturedBody = String(init?.body);
            capturedHeaders = new Headers(init?.headers);
            capturedRedirect = init?.redirect;
            return new Response(JSON.stringify(providerProduct()), {
                headers: { "content-type": "application/json" },
            });
        },
    });
    assert.equal(capturedUrl, `${SHOPIER_API_BASE_URL}${SHOPIER_PRODUCTS_PATH}`);
    assert.equal(capturedHeaders.get("authorization"), `Bearer ${token}`);
    assert.equal(capturedHeaders.get("content-type"), "application/json");
    assert.equal(capturedRedirect, "error");
    assert.equal(capturedBody.includes(token), false);
    const body = JSON.parse(capturedBody) as Record<string, unknown>;
    assert.equal(body.type, "digital");
    assert.equal(body.customListing, true);
    assert.equal(body.stockQuantity, 1);
    assert.equal(body.shippingPayer, "sellerPays");
    assert.deepEqual(body.priceData, { currency: "TRY", price: "11.97", discount: false });
    assert.deepEqual(result, {
        productId: "689793",
        checkoutUrl: "https://www.shopier.com/689793",
        amountMinor: 1_197,
        currency: "TRY",
    });

    let listingRequestUrl = "";
    let listingRequestInit: RequestInit | undefined;
    const listings = await listShopierCustomListings({
        dateStart: new Date("2026-08-10T09:00:00Z"),
        dateEnd: new Date("2026-08-10T11:00:00Z"),
        credentials: request.credentials,
        fetchImpl: async (input, init) => {
            listingRequestUrl = String(input);
            listingRequestInit = init;
            return new Response(JSON.stringify([providerProduct()]));
        },
    });
    assert.equal(listings.length, 1);
    assert.ok(listingRequestUrl);
    const listingUrl = new URL(listingRequestUrl);
    assert.equal(`${listingUrl.origin}${listingUrl.pathname}`, `${SHOPIER_API_BASE_URL}${SHOPIER_PRODUCTS_PATH}`);
    assert.equal(listingUrl.searchParams.get("customListing"), "true");
    assert.equal(listingUrl.searchParams.get("dateStart"), "2026-08-10T09:00:00+0000");
    assert.equal(listingUrl.searchParams.get("limit"), "50");
    assert.equal(new Headers(listingRequestInit?.headers).get("authorization"), `Bearer ${token}`);
    assert.equal(listingRequestInit?.redirect, "error");

    let orderRequestUrl = "";
    const orders = await listShopierPaidOrdersByProduct({
        productId: "689793",
        credentials: request.credentials,
        fetchImpl: async (input) => {
            orderRequestUrl = String(input);
            return new Response(JSON.stringify([providerOrder()]));
        },
    });
    assert.equal(orders.length, 1);
    const orderUrl = new URL(orderRequestUrl);
    assert.equal(`${orderUrl.origin}${orderUrl.pathname}`, `${SHOPIER_API_BASE_URL}${SHOPIER_ORDERS_PATH}`);
    assert.equal(orderUrl.searchParams.get("productId"), "689793");
    assert.equal(orderUrl.searchParams.get("limit"), "2");
    await expectCode(() => listShopierPaidOrdersByProduct({
        productId: "../orders",
        credentials: request.credentials,
        fetchImpl: async () => new Response("[]"),
    }), "invalid_request");
    await expectCode(() => listShopierPaidOrdersByProduct({
        productId: "689793",
        credentials: request.credentials,
        fetchImpl: async () => new Response(JSON.stringify([providerOrder({ paymentStatus: "unpaid" })])),
    }), "invalid_provider_response");

    assert.equal(isAllowedShopierHostedUrl("https://www.shopier.com/689793", "689793"), true);
    for (const url of [
        "http://www.shopier.com/689793",
        "https://shopier.com/689793",
        "https://www.shopier.com.evil.test/689793",
        "https://www.shopier.com/689793?next=evil",
        "https://www.shopier.com/other",
    ]) assert.equal(isAllowedShopierHostedUrl(url, "689793"), false, url);

    await expectCode(() => createShopierCustomListing({
        ...request,
        credentials: { personalAccessToken: "short" },
        fetchImpl: async () => new Response(JSON.stringify(providerProduct())),
    }), "invalid_request");
    await expectCode(() => createShopierCustomListing({
        ...request,
        fetchImpl: async () => new Response(JSON.stringify(providerProduct({ url: "https://evil.test/689793" }))),
    }), "invalid_provider_response");
    await expectCode(() => createShopierCustomListing({
        ...request,
        fetchImpl: async () => new Response(JSON.stringify(providerProduct({ priceData: { currency: "TRY", price: "11.98" } }))),
    }), "invalid_provider_response");
    await expectCode(() => createShopierCustomListing({
        ...request,
        fetchImpl: async () => new Response(JSON.stringify(providerProduct({ stockQuantity: 2 }))),
    }), "invalid_provider_response");
    await expectCode(() => createShopierCustomListing({
        ...request,
        fetchImpl: async () => new Response(JSON.stringify({ error: "secret provider detail" }), { status: 429 }),
    }), "provider_rate_limited");
    await expectCode(() => createShopierCustomListing({
        ...request,
        fetchImpl: async () => new Response("x".repeat(65_537)),
    }), "invalid_provider_response");

    const readinessEnvironment = {
        SHOPIER_PERSONAL_ACCESS_TOKEN: token,
        SHOPIER_PRODUCT_MEDIA_URL: request.mediaUrl,
        SHOPIER_CHECKOUT_MODE: "live",
        SHOPIER_WEBHOOK_MODE: "live",
        SHOPIER_RECONCILIATION_MODE: "live",
        SHOPIER_REFUND_MODE: "live",
        SHOPIER_WEBHOOK_TOKEN: "shopier-webhook-token-with-safe-length",
        SHOPIER_ACCOUNT_ID: "123456",
        SHOPIER_LIVE_ACCEPTANCE_RECORDED: "true",
        SHOPIER_LIVE_ACCEPTANCE_EVIDENCE_SHA256: `sha256:${"a".repeat(64)}`,
    };
    const readiness = getPaymentProviderReadiness("shopier_v2", readinessEnvironment);
    assert.equal(readiness.credentialsConfigured, true);
    assert.equal(readiness.adapterAvailable, true);
    assert.equal(readiness.ready, true);
    assert.equal(getPaymentProviderReadiness("shopier_v2", {
        ...readinessEnvironment,
        SHOPIER_LIVE_ACCEPTANCE_RECORDED: "false",
    }).credentialsConfigured, false);
    assert.equal(getPaymentProviderReadiness("shopier_v2", {
        ...readinessEnvironment,
        SHOPIER_CHECKOUT_MODE: "sandbox",
    }).credentialsConfigured, false, "Shopier does not publish a sandbox API");

    const route = await readFile("apps/web/src/app/api/payments/checkout/session/route.ts", "utf8");
    assert.match(route, /createShopierCheckoutListing/);
    assert.match(route, /SHOPIER_PERSONAL_ACCESS_TOKEN/);
    assert.match(route, /runtime\.activeProvider === "shopier_v2"/);
    console.log("Shopier custom listing adapter foundation checks passed");
}

void run();
