import { randomBytes } from "node:crypto";
import { hashOpaqueToken } from "@hushle/platform-auth";

// The stream screen's capability URL (/stream/<viewKey>): 32 random bytes, shown to the
// streamer once per rotation. Only the sha256 hex digest is stored (stream_sessions.view_key_hash).

export const VIEW_KEY_BYTES = 32;

export function hashViewKey(viewKey: string): string {
    return hashOpaqueToken(viewKey);
}

export function createViewKey(): { viewKey: string; hash: string } {
    const viewKey = randomBytes(VIEW_KEY_BYTES).toString("base64url");
    return { viewKey, hash: hashViewKey(viewKey) };
}
