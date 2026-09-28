import {
    PAYMENT_ORDER_STATUSES,
    type PaymentOrderStatus,
} from "./contracts";

const transitions = {
    created: ["pending_provider", "failed", "expired"],
    pending_provider: ["awaiting_payment", "failed", "expired"],
    awaiting_payment: ["paid", "failed", "expired"],
    paid: ["fulfilled", "refunded", "chargeback"],
    fulfilled: ["refunded", "chargeback"],
    failed: [],
    expired: [],
    refunded: ["chargeback"],
    chargeback: [],
} as const satisfies Record<PaymentOrderStatus, readonly PaymentOrderStatus[]>;

export class PaymentOrderTransitionError extends Error {
    constructor(
        public readonly from: PaymentOrderStatus,
        public readonly to: PaymentOrderStatus
    ) {
        super(`Payment order cannot transition from ${from} to ${to}`);
        this.name = "PaymentOrderTransitionError";
    }
}

export function isPaymentOrderStatus(value: string): value is PaymentOrderStatus {
    return PAYMENT_ORDER_STATUSES.includes(value as PaymentOrderStatus);
}

export function canTransitionPaymentOrder(
    from: PaymentOrderStatus,
    to: PaymentOrderStatus
): boolean {
    return (transitions[from] as readonly PaymentOrderStatus[]).includes(to);
}

export function assertPaymentOrderTransition(
    from: PaymentOrderStatus,
    to: PaymentOrderStatus
): void {
    if (!canTransitionPaymentOrder(from, to)) {
        throw new PaymentOrderTransitionError(from, to);
    }
}

export function getAllowedPaymentOrderTransitions(
    status: PaymentOrderStatus
): readonly PaymentOrderStatus[] {
    return transitions[status];
}
