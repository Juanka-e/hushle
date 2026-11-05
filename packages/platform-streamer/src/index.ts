export {
    connectionAad,
    decryptToken,
    encryptToken,
    loadTokenKeyring,
    StreamerConfigError,
    TokenDecryptError,
    type TokenDecryptReason,
    type TokenKey,
    type TokenKeyring,
    type TokenKeyringEnvironment,
} from "./token-crypto";
export {
    isStreamerPlatform,
    PLATFORM_LABELS,
    STREAMER_PLATFORMS,
    StreamerPlatformError,
    type FetchLike,
    type PlatformIdentity,
    type StreamerPlatform,
    type StreamerPlatformClient,
    type StreamerPlatformErrorKind,
    type TokenHint,
    type TokenSet,
} from "./platform-client";
export { createTwitchPlatformClient, type TwitchEnvironment } from "./twitch-client";
export { createKickPlatformClient, type KickEnvironment } from "./kick-client";
export { createFakePlatformClient, FAKE_AUTHORIZE_PATH, type FakePlatformClient } from "./fake-client";
export {
    createStreamerPlatformClient,
    isFakePlatformEnabled,
    isPlatformConfigured,
    type StreamerPlatformEnvironment,
} from "./client-factory";
export {
    createMemoryStreamerConnectionStore,
    prismaStreamerConnectionStore,
    type MemoryStreamerConnectionStore,
    type StatusReason,
    type StreamerConnectionRecord,
    type StreamerConnectionStatusValue,
    type StreamerConnectionStore,
    type UpdateTokensInput,
    type UpsertLinkedInput,
} from "./connection-store";
export {
    callWithToken,
    getAccessToken,
    REFRESH_LEEWAY_MS,
    revokeConnectionTokens,
    StreamerReconnectRequired,
    type TokenServiceDeps,
} from "./token-service";
