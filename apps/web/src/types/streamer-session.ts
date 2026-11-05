import type { CardBackOption } from "@/lib/streamer/card-backs";
import type { CreateSessionInput, StreamSessionView } from "@/lib/streamer/session-service";

export type { CardBackOption, CreateSessionInput, StreamSessionView };

/** The stream screen addresses a host copies into the broadcasting software. */
export interface StreamUrls {
    full: string;
    half: string;
    stripTop: string;
    stripBottom: string;
}

/** GET /api/streamer/sessions */
export interface StreamSessionResponse {
    enabled: boolean;
    session: StreamSessionView | null;
    lastSettings: CreateSessionInput | null;
    cardBacks: CardBackOption[];
}

/** POST /api/streamer/sessions */
export interface CreateStreamSessionResponse {
    session: StreamSessionView;
    viewKey: string;
    urls: StreamUrls;
}

/** POST /api/streamer/sessions/current/view-key */
export interface RotateViewKeyResponse {
    viewKey: string;
    urls: StreamUrls;
}
