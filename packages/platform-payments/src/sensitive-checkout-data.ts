import { z } from "zod";

export const PAYMENT_BUYER_DATA_POLICY_VERSION = "buyer-data-v1";

function collapseWhitespace(value: string): string {
    return value.trim().replace(/\s+/g, " ");
}

const normalizedText = (min: number, max: number) =>
    z.string().min(min).max(max).transform(collapseWhitespace);

const phoneSchema = z.string().trim().min(7).max(20)
    .regex(/^\+?[0-9 ()-]+$/)
    .transform((value) => `${value.startsWith("+") ? "+" : ""}${value.replace(/\D/g, "")}`)
    .refine((value) => /^\+?\d{7,15}$/.test(value));

export const paymentCheckoutContactSchema = z.object({
    fullName: normalizedText(2, 60),
    phone: phoneSchema,
    address: normalizedText(10, 400),
});

export const iyzicoCheckoutBuyerDataSchema = z.object({
    givenName: normalizedText(1, 60),
    familyName: normalizedText(1, 60),
    identityNumber: z.string().trim().regex(/^\d{11}$/),
    phone: phoneSchema,
    addressLine: normalizedText(5, 400),
    city: normalizedText(2, 80),
    country: normalizedText(2, 80),
    zipCode: normalizedText(1, 20).optional(),
});

export type IyzicoCheckoutBuyerData = z.input<typeof iyzicoCheckoutBuyerDataSchema>;

export interface PaymentBuyerDataPolicy {
    version: typeof PAYMENT_BUYER_DATA_POLICY_VERSION;
    provider: "paytr" | "iyzico";
    destination: "PayTR" | "iyzico";
    categories: readonly string[];
    checkoutPayloadPersistence: "request_only";
    localValueLogging: "forbidden";
    localValueHashing: "forbidden";
    activation: "sandbox_active" | "sandbox_ui_ready_live_blocked";
}

const policies = {
    paytr: {
        version: PAYMENT_BUYER_DATA_POLICY_VERSION,
        provider: "paytr",
        destination: "PayTR",
        categories: ["account_email", "full_name", "phone", "address", "request_ip"],
        checkoutPayloadPersistence: "request_only",
        localValueLogging: "forbidden",
        localValueHashing: "forbidden",
        activation: "sandbox_active",
    },
    iyzico: {
        version: PAYMENT_BUYER_DATA_POLICY_VERSION,
        provider: "iyzico",
        destination: "iyzico",
        categories: [
            "account_email",
            "given_and_family_name",
            "government_identifier",
            "phone",
            "billing_address",
            "request_ip",
        ],
        checkoutPayloadPersistence: "request_only",
        localValueLogging: "forbidden",
        localValueHashing: "forbidden",
        activation: "sandbox_ui_ready_live_blocked",
    },
} as const satisfies Record<"paytr" | "iyzico", PaymentBuyerDataPolicy>;

export function getPaymentBuyerDataPolicy(provider: "paytr" | "iyzico"): PaymentBuyerDataPolicy {
    return policies[provider];
}

export function getSafePaymentBuyerDataDiagnostics(provider: "paytr" | "iyzico"): {
    provider: "paytr" | "iyzico";
    policyVersion: string;
    categories: readonly string[];
    checkoutPayloadPersistence: "request_only";
} {
    const policy = getPaymentBuyerDataPolicy(provider);
    return {
        provider,
        policyVersion: policy.version,
        categories: policy.categories,
        checkoutPayloadPersistence: policy.checkoutPayloadPersistence,
    };
}

export function buildIyzicoEphemeralBuyer(input: {
    userId: number;
    verifiedEmail: string;
    requestIp: string;
    data: IyzicoCheckoutBuyerData;
}): {
    buyer: {
        id: string;
        name: string;
        surname: string;
        identityNumber: string;
        email: string;
        gsmNumber: string;
        registrationAddress: string;
        city: string;
        country: string;
        zipCode?: string;
        ip: string;
    };
    billingAddress: {
        address: string;
        contactName: string;
        city: string;
        country: string;
        zipCode?: string;
    };
    shippingAddress: {
        address: string;
        contactName: string;
        city: string;
        country: string;
        zipCode?: string;
    };
} {
    const context = z.object({
        userId: z.number().int().positive(),
        verifiedEmail: z.string().trim().email().max(100),
        requestIp: z.string().trim().min(3).max(64),
    }).safeParse(input);
    const data = iyzicoCheckoutBuyerDataSchema.safeParse(input.data);
    if (!context.success || !data.success) {
        throw new Error("invalid_iyzico_buyer_data");
    }

    const contactName = `${data.data.givenName} ${data.data.familyName}`;
    const address = {
        address: data.data.addressLine,
        contactName,
        city: data.data.city,
        country: data.data.country,
        ...(data.data.zipCode ? { zipCode: data.data.zipCode } : {}),
    };
    return {
        buyer: {
            id: `user:${context.data.userId}`,
            name: data.data.givenName,
            surname: data.data.familyName,
            identityNumber: data.data.identityNumber,
            email: context.data.verifiedEmail,
            gsmNumber: data.data.phone,
            registrationAddress: data.data.addressLine,
            city: data.data.city,
            country: data.data.country,
            ...(data.data.zipCode ? { zipCode: data.data.zipCode } : {}),
            ip: context.data.requestIp,
        },
        billingAddress: { ...address },
        shippingAddress: { ...address },
    };
}
