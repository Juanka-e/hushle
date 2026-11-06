import { getPlayerErrorMessage } from "@/lib/errors/player-error";
import { PlayerErrorCode } from "@/lib/errors/player-error-codes";
import { DEFAULT_LOCALE, type AppLocale } from "@/lib/i18n/config";

export const CURRENT_SOCKET_PROTOCOL_VERSION = 1;
export const MINIMUM_SOCKET_PROTOCOL_VERSION = 0;

export const SOCKET_PROTOCOL_ERROR_CODE = PlayerErrorCode.SOCKET_PROTOCOL_UNSUPPORTED;

export interface SocketProtocolDecision {
  accepted: boolean;
  clientVersion: number | null;
  effectiveClientVersion: number;
  serverVersion: number;
  minimumVersion: number;
  reason: "compatible" | "invalid" | "too_old" | "too_new";
}

export interface SocketProtocolErrorData {
  code: typeof SOCKET_PROTOCOL_ERROR_CODE;
  clientVersion: number | null;
  serverVersion: number;
  minimumVersion: number;
  reason: SocketProtocolDecision["reason"];
}

export const SOCKET_CLIENT_AUTH = Object.freeze({
  clientProtocolVersion: CURRENT_SOCKET_PROTOCOL_VERSION,
});

function parseProtocolVersion(value: unknown): number | null {
  return typeof value === "number" && Number.isSafeInteger(value) && value >= 0
    ? value
    : null;
}

export function evaluateSocketProtocolVersion(
  rawVersion: unknown,
): SocketProtocolDecision {
  const isLegacyClient = rawVersion === undefined || rawVersion === null;
  const parsedVersion = isLegacyClient ? 0 : parseProtocolVersion(rawVersion);

  if (parsedVersion === null) {
    return {
      accepted: false,
      clientVersion: null,
      effectiveClientVersion: -1,
      serverVersion: CURRENT_SOCKET_PROTOCOL_VERSION,
      minimumVersion: MINIMUM_SOCKET_PROTOCOL_VERSION,
      reason: "invalid",
    };
  }

  const reason =
    parsedVersion < MINIMUM_SOCKET_PROTOCOL_VERSION
      ? "too_old"
      : parsedVersion > CURRENT_SOCKET_PROTOCOL_VERSION
        ? "too_new"
        : "compatible";

  return {
    accepted: reason === "compatible",
    clientVersion: isLegacyClient ? null : parsedVersion,
    effectiveClientVersion: parsedVersion,
    serverVersion: CURRENT_SOCKET_PROTOCOL_VERSION,
    minimumVersion: MINIMUM_SOCKET_PROTOCOL_VERSION,
    reason,
  };
}

export function readSocketProtocolVersionFromAuth(auth: unknown): unknown {
  if (!auth || typeof auth !== "object" || Array.isArray(auth)) {
    return undefined;
  }
  return (auth as Record<string, unknown>).clientProtocolVersion;
}

/**
 * The handshake middleware refused this client's socket protocol (its `connect_error` carries
 * SocketProtocolErrorData): the one check for the refresh prompt and the stream screen's reload.
 */
export function isSocketProtocolRefusal(error: unknown): boolean {
  if (!error || typeof error !== "object") return false;
  const data = (error as { data?: unknown }).data;
  if (!data || typeof data !== "object" || Array.isArray(data)) return false;
  return (data as { code?: unknown }).code === SOCKET_PROTOCOL_ERROR_CODE;
}

/** Localized refresh prompt when the server rejected this client's protocol version, otherwise null. */
export function getSocketProtocolErrorMessage(
  error: unknown,
  locale: AppLocale = DEFAULT_LOCALE,
): string | null {
  if (!isSocketProtocolRefusal(error)) return null;
  return getPlayerErrorMessage(SOCKET_PROTOCOL_ERROR_CODE, undefined, locale);
}
