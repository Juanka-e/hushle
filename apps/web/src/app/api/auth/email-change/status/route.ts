import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { getSessionUser } from "@/lib/session";

export async function GET() {
    const sessionUser = await getSessionUser();
    if (!sessionUser) {
        return NextResponse.json({ error: "Giriş gerekli." }, { status: 401 });
    }
    const user = await prisma.user.findUnique({
        where: { id: sessionUser.id },
        select: {
            pendingEmail: true,
            pendingEmailRequestedAt: true,
        },
    });
    return NextResponse.json({
        pendingEmail: user?.pendingEmail ?? null,
        pendingEmailRequestedAt:
            user?.pendingEmailRequestedAt?.toISOString() ?? null,
    });
}
