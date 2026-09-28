import { NextResponse } from "next/server";
import {
    canUseAccountCapability,
    type AccountCapability,
    type AccountCapabilityRecord,
} from "@hushle/platform-auth";

export function enforceAccountCapability(
    account: AccountCapabilityRecord,
    capability: AccountCapability
): NextResponse | null {
    if (canUseAccountCapability(account, capability)) {
        return null;
    }

    return NextResponse.json(
        {
            error:
                "Bu işlemi kullanmak için önce e-posta adresini doğrulamalısın.",
            code: "EMAIL_VERIFICATION_REQUIRED",
        },
        { status: 403 }
    );
}
