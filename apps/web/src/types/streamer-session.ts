import type { StreamerPlatform } from "@hushle/platform-streamer";
import type { AppLocale } from "@/lib/i18n/config";
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

/** POST /api/streamer/sessions/current/end: the ended session, as the end call produced it. */
export interface EndStreamSessionResponse {
    ok: true;
    session: StreamSessionView;
}

/** An active channel link the host may open a session on. */
export interface StreamerPanelChannel {
    platform: StreamerPlatform;
    label: string;
    displayName: string;
}

/** A visible word category as the session form lists it (one level of children, as rooms use). */
export interface StreamerPanelCategory {
    id: number;
    name: string;
    children: Array<{ id: number; name: string }>;
}

/** What the /streamer page computes server-side for the host panel's first paint. */
export interface StreamerPanelInitial {
    /** The same body GET /api/streamer/sessions returns. */
    data: StreamSessionResponse;
    channels: StreamerPanelChannel[];
    /** Both packs: the session's word language picks the list. */
    categories: Record<CreateSessionInput["language"], StreamerPanelCategory[]>;
    locale: AppLocale;
}
