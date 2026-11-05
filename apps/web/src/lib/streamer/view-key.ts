import { randomBytes } from "node:crypto";
import { hashOpaqueToken } from "@hushle/platform-auth";

// The stream screen's capability URL (/stream/<viewKey>): 32 random bytes, shown to the
// streamer once per rotation. Only the sha256 hex digest is stored (stream_sessions.view_key_hash).

export const VIEW_KEY_BYTES = 32;

// One limit for every rotation path (POST /api/streamer/sessions/current/view-key and the host
// panel's streamer:host:rotate-key), keyed `user:<id>`: both draw on the same bucket.
export const STREAMER_VIEW_KEY_LIMIT = { bucket: "streamer-view-key", windowMs: 15 * 60_000, maxRequests: 10 } as const;

export function hashViewKey(viewKey: string): string {
    return hashOpaqueToken(viewKey);
}

export function createViewKey(): { viewKey: string; hash: string } {
    const viewKey = randomBytes(VIEW_KEY_BYTES).toString("base64url");
    return { viewKey, hash: hashViewKey(viewKey) };
}
