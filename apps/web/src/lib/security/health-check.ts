import { timingSafeEqual } from "crypto";

function safeCompare(left: string, right: string): boolean {
    const leftBuffer = Buffer.from(left);
    const rightBuffer = Buffer.from(right);

    if (leftBuffer.length !== rightBuffer.length) {
        return false;
    }

    return timingSafeEqual(leftBuffer, rightBuffer);
}

export function isHealthEndpointAllowed(requestHeaders: Headers, isDev: boolean): boolean {
    if (isDev) {
        return true;
    }

    const expectedToken = process.env.HEALTHCHECK_TOKEN?.trim();
    if (!expectedToken) {
        return false;
    }

    const providedToken = requestHeaders.get("x-health-token")?.trim();
    if (!providedToken) {
        return false;
    }

    return safeCompare(providedToken, expectedToken);
}
