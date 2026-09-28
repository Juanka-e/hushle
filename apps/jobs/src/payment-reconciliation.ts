import { runPaymentReconciliation } from "@hushle/platform-payments";
import type { PaymentReconciliationConfig } from "./config";

export async function runPaymentReconciliationJob(input: {
    config: PaymentReconciliationConfig;
    dryRun: boolean;
    now?: Date;
}) {
    return runPaymentReconciliation({
        config: input.config,
        dryRun: input.dryRun,
        now: input.now,
    });
}
