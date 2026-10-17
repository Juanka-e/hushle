/** Shared by the room client and the socket server; keep free of server imports. */
export const CONNECTION_PAUSE_RESOLVE_EVENT = "connection_pause:resolve";

export const CONNECTION_PAUSE_RESOLVE_ACTIONS = [
    "continue_without_missing",
    "end_match",
] as const;

export type ConnectionPauseResolveAction =
    (typeof CONNECTION_PAUSE_RESOLVE_ACTIONS)[number];

export interface ConnectionPauseResolvePayload {
    action: ConnectionPauseResolveAction;
}
