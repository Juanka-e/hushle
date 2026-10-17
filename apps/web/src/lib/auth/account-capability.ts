import { NextResponse } from "next/server";
import {
    canUseAccountCapability,
    type AccountCapability,
    type AccountCapabilityRecord,
} from "@hushle/platform-auth";
import { PlayerErrorCode, playerError } from "@/lib/errors/player-error";

export function enforceAccountCapability(
    account: AccountCapabilityRecord,
    capability: AccountCapability
): NextResponse | null {
    if (canUseAccountCapability(account, capability)) {
        return null;
    }

    return NextResponse.json(
        playerError(PlayerErrorCode.EMAIL_VERIFICATION_REQUIRED),
        { status: 403 }
    );
}
