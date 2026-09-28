import { prisma } from "@/lib/prisma";
import { getRequestIp } from "@/lib/security/request-rate-limit";

const ACCESS_SIGNAL_HEARTBEAT_MS = 15 * 60 * 1000;

function getTrustedRequestIp(request: Request): string | null {
    const ip = getRequestIp(request);
    return ip === "unknown" ? null : ip.slice(0, 64);
}

function getRequestUserAgent(request: Request): string | null {
    const userAgent = request.headers.get("user-agent");
    return userAgent ? userAgent.slice(0, 255) : null;
}

export async function recordUserAccessSignal(input: {
    userId: number;
    request: Request;
}): Promise<void> {
    const { userId, request } = input;
    const now = new Date();
    const heartbeatFloor = new Date(now.getTime() - ACCESS_SIGNAL_HEARTBEAT_MS);
    const trustedIp = getTrustedRequestIp(request);
    const userAgent = getRequestUserAgent(request);

    await prisma.user.updateMany({
        where: {
            id: userId,
            OR: [
                { lastSeenAt: null },
                { lastSeenAt: { lt: heartbeatFloor } },
                ...(trustedIp ? [{ lastTrustedIp: { not: trustedIp } }] : []),
                ...(userAgent ? [{ lastUserAgent: { not: userAgent } }] : []),
            ],
        },
        data: {
            lastSeenAt: now,
            ...(trustedIp ? { lastTrustedIp: trustedIp } : {}),
            ...(userAgent ? { lastUserAgent: userAgent } : {}),
        },
    });
}

export async function recordUserRegistrationSignal(input: {
    userId: number;
    request: Request;
}): Promise<void> {
    const { userId, request } = input;
    const trustedIp = getTrustedRequestIp(request);
    const userAgent = getRequestUserAgent(request);

    await prisma.user.update({
        where: { id: userId },
        data: {
            lastSeenAt: new Date(),
            ...(trustedIp ? { lastTrustedIp: trustedIp, registeredTrustedIp: trustedIp } : {}),
            ...(userAgent ? { lastUserAgent: userAgent } : {}),
        },
    });
}
