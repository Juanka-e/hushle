import type { StreamerPlatform } from "@hushle/platform-streamer";

export type StreamerConnectionStatus = "active" | "needs_reconnect" | "revoked";

export interface StreamerConnectionSummary {
    login: string;
    displayName: string;
    avatarUrl: string | null;
    channelUrl: string;
    status: StreamerConnectionStatus;
    statusReason: string | null;
    connectedAt: string;
}

export interface StreamerConnectionView {
    platform: StreamerPlatform;
    label: string;
    configured: boolean;
    connection: StreamerConnectionSummary | null;
}

export interface StreamerConnectionsResponse {
    enabled: boolean;
    platforms: StreamerConnectionView[];
}
