import { emitObservabilityEvent } from "@hushle/platform-observability";
import {
    createStreamerPlatformClient,
    isFakePlatformEnabled,
    isPlatformConfigured,
    loadTokenKeyring,
    prismaStreamerConnectionStore,
    type StreamerPlatform,
    type TokenKeyring,
} from "@hushle/platform-streamer";
import type { NextRequest } from "next/server";
import { writeAuditLog } from "@/lib/security/audit-log";
import { consumeDistributedRequestRateLimit } from "@/lib/security/request-rate-limit";
import { getSystemSettings } from "@/lib/system-settings/service";
import { requireConnectStateSecret } from "./connect-state";
import type { ConnectFlowDeps } from "./connect-flow";

// Real wiring for the streamer connection flows. Config errors (missing key, missing
// secret) surface here, once, instead of inside a half-finished OAuth exchange.

let keyringCache: TokenKeyring | null = null;

export function getStreamerKeyring(): TokenKeyring {
    if (!keyringCache) keyringCache = loadTokenKeyring(process.env);
    return keyringCache;
}

export function isStreamerPlatformConfigured(platform: StreamerPlatform): boolean {
    return isPlatformConfigured(platform, process.env);
}

export function isFakeStreamerPlatformEnabled(): boolean {
    return isFakePlatformEnabled(process.env);
}

export async function isStreamerModeEnabled(): Promise<boolean> {
    const settings = await getSystemSettings();
    return settings.features.streamerModeEnabled === true;
}

// The origin platforms redirect back to. Behind a proxy the request origin can be the
// internal one, so production sets STREAMER_OAUTH_PUBLIC_ORIGIN (or NEXT_PUBLIC_SITE_URL).
export function resolveConnectOrigin(request: NextRequest): string {
    const configured = process.env.STREAMER_OAUTH_PUBLIC_ORIGIN?.trim() || process.env.NEXT_PUBLIC_SITE_URL?.trim();
    if (configured) {
        try {
            return new URL(configured).origin;
        } catch {
            // fall through to the request origin
        }
    }
    return request.nextUrl.origin;
}

export function createConnectFlowDeps(request: Request | null): ConnectFlowDeps {
    return {
        store: prismaStreamerConnectionStore,
        keyring: getStreamerKeyring(),
        secret: requireConnectStateSecret(process.env),
        isStreamerModeEnabled,
        isPlatformConfigured: isStreamerPlatformConfigured,
        clientFor: (platform) => createStreamerPlatformClient(platform, process.env),
        consumeRateLimit: consumeDistributedRequestRateLimit,
        writeAudit: (entry) =>
            writeAuditLog({
                actor: entry.actor,
                action: entry.action,
                resourceType: entry.resourceType,
                resourceId: entry.resourceId ?? null,
                summary: entry.summary ?? null,
                metadata: entry.metadata ?? null,
                request,
            }),
        emitEvent: (event) => emitObservabilityEvent({ level: event.level, service: "hushle-web", event: event.event, context: event.context }),
    };
}
