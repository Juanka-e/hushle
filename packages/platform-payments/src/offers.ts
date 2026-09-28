import { prisma } from "@hushle/platform-db";
import { isPaymentGrantSnapshotSupported } from "./grant-contract";

export interface PaymentOfferView {
    code: string;
    productKind: "cosmetic_item" | "cosmetic_bundle" | "coin_pack";
    productName: string;
    description: string | null;
    unitAmountMinor: number;
    currency: string;
}

export async function listActivePaymentOffers(now = new Date()): Promise<PaymentOfferView[]> {
    const offers = await prisma.paymentOffer.findMany({
        where: {
            isActive: true,
            AND: [
                { OR: [{ startsAt: null }, { startsAt: { lte: now } }] },
                { OR: [{ endsAt: null }, { endsAt: { gt: now } }] },
            ],
        },
        orderBy: [{ sortOrder: "asc" }, { id: "asc" }],
        select: {
            code: true,
            productKind: true,
            productName: true,
            description: true,
            unitAmountMinor: true,
            currency: true,
            grantSnapshot: true,
        },
    });

    return offers.flatMap((offer) => {
        if (!isPaymentGrantSnapshotSupported({
            productKind: offer.productKind,
            quantity: 1,
            grantSnapshot: offer.grantSnapshot,
        })) return [];
        return [{
            code: offer.code,
            productKind: offer.productKind,
            productName: offer.productName,
            description: offer.description,
            unitAmountMinor: offer.unitAmountMinor,
            currency: offer.currency,
        }];
    });
}

export async function getActivePaymentOffer(code: string, now = new Date()) {
    const offer = await prisma.paymentOffer.findFirst({
        where: {
            code,
            isActive: true,
            AND: [
                { OR: [{ startsAt: null }, { startsAt: { lte: now } }] },
                { OR: [{ endsAt: null }, { endsAt: { gt: now } }] },
            ],
        },
    });
    if (!offer || !isPaymentGrantSnapshotSupported({
        productKind: offer.productKind,
        quantity: 1,
        grantSnapshot: offer.grantSnapshot,
    })) return null;
    return offer;
}
