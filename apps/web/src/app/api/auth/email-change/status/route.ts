import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { getSessionUser } from "@/lib/session";
import { PlayerErrorCode, playerError } from "@/lib/errors/player-error";

export async function GET() {
    const sessionUser = await getSessionUser();
    if (!sessionUser) {
        return NextResponse.json(playerError(PlayerErrorCode.AUTH_REQUIRED), { status: 401 });
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
