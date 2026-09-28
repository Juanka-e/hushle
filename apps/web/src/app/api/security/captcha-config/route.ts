import { NextResponse } from "next/server";
import { z } from "zod";
import { CAPTCHA_ACTIONS } from "@/types/captcha";
import { getSystemSettings } from "@/lib/system-settings/service";
import { getPublicCaptchaConfigForAction } from "@/lib/security/captcha";

const querySchema = z.object({
    action: z.enum(CAPTCHA_ACTIONS),
});

export const dynamic = "force-dynamic";

export async function GET(req: Request) {
    const { searchParams } = new URL(req.url);
    const parsed = querySchema.safeParse({
        action: searchParams.get("action"),
    });

    if (!parsed.success) {
        return NextResponse.json({ error: "Gecersiz captcha aksiyonu." }, { status: 422 });
    }

    const settings = await getSystemSettings();
    const config = getPublicCaptchaConfigForAction(settings, parsed.data.action);

    return NextResponse.json(config);
}
