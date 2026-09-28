import { NextResponse } from "next/server";
import {
    isEmailVerificationRestrictionActive,
} from "@hushle/platform-auth";
import { getEmailProviderReadiness } from "@hushle/platform-email";
import { getSessionUser } from "@/lib/session";
import { getSystemSettings } from "@/lib/system-settings/service";

export async function GET() {
    const user = await getSessionUser();
    if (!user) {
        return NextResponse.json({ error: "Giriş gerekli." }, { status: 401 });
    }
    const settings = await getSystemSettings();
    const readiness = getEmailProviderReadiness();

    return NextResponse.json({
        mode: settings.security.emailVerification.mode,
        providerReady: readiness.configured,
        emailVerifiedAt: user.emailVerifiedAt?.toISOString() ?? null,
        verificationRequired:
            user.emailVerificationRequiredAt !== null,
        restricted: isEmailVerificationRestrictionActive(user),
    });
}
