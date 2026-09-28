import { createHmac, randomUUID, timingSafeEqual } from "node:crypto";

const GUEST_TOKEN_TTL_MS = 24 * 60 * 60 * 1000;
const DEV_GUEST_SECRET = "dev-guest-identity-secret";

interface GuestIdentityPayload {
    guestId: string;
    exp: number;
}

export interface ResolvedPlayerIdentity {
    playerId: string;
    userId: number | null;
    guestToken: string | null;
    isGuest: boolean;
}

function getGuestIdentitySecret(): string {
    return process.env.GUEST_IDENTITY_SECRET || process.env.AUTH_SECRET || DEV_GUEST_SECRET;
}

function encodePayload(payload: GuestIdentityPayload): string {
    return Buffer.from(JSON.stringify(payload), "utf8").toString("base64url");
}

function signPayload(encodedPayload: string): string {
    return createHmac("sha256", getGuestIdentitySecret())
        .update(encodedPayload)
        .digest("base64url");
}

export function createGuestIdentityToken(guestId?: string, now = Date.now()): string {
    const resolvedGuestId = guestId ?? randomUUID();
    const payload: GuestIdentityPayload = {
        guestId: resolvedGuestId,
        exp: now + GUEST_TOKEN_TTL_MS,
    };
    const encodedPayload = encodePayload(payload);
    const signature = signPayload(encodedPayload);

    return `${encodedPayload}.${signature}`;
}

export function verifyGuestIdentityToken(token: string, now = Date.now()): GuestIdentityPayload | null {
    const [encodedPayload, signature] = token.split(".");
    if (!encodedPayload || !signature) {
        return null;
    }

    const expectedSignature = signPayload(encodedPayload);
    const providedSignature = Buffer.from(signature, "utf8");
    const validSignature = Buffer.from(expectedSignature, "utf8");

    if (providedSignature.length !== validSignature.length) {
        return null;
    }

    if (!timingSafeEqual(providedSignature, validSignature)) {
        return null;
    }

    try {
        const parsed = JSON.parse(
            Buffer.from(encodedPayload, "base64url").toString("utf8")
        ) as Partial<GuestIdentityPayload>;

        if (
            typeof parsed.guestId !== "string" ||
            parsed.guestId.length < 10 ||
            typeof parsed.exp !== "number" ||
            parsed.exp <= now
        ) {
            return null;
        }

        return {
            guestId: parsed.guestId,
            exp: parsed.exp,
        };
    } catch {
        return null;
    }
}

export function resolveSocketPlayerIdentity(
    authUserId: number | null,
    guestToken?: string
): ResolvedPlayerIdentity {
    if (authUserId && Number.isInteger(authUserId) && authUserId > 0) {
        return {
            playerId: `user:${authUserId}`,
            userId: authUserId,
            guestToken: null,
            isGuest: false,
        };
    }

    const verifiedGuest = guestToken ? verifyGuestIdentityToken(guestToken) : null;
    const guestId = verifiedGuest?.guestId ?? randomUUID();
    const resolvedGuestToken = verifiedGuest
        ? guestToken ?? createGuestIdentityToken(guestId)
        : createGuestIdentityToken(guestId);

    return {
        playerId: `guest:${guestId}`,
        userId: null,
        guestToken: resolvedGuestToken,
        isGuest: true,
    };
}
