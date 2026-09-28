export const CURRENT_SOCKET_PROTOCOL_VERSION = 1;
export const MINIMUM_SOCKET_PROTOCOL_VERSION = 0;

export const SOCKET_PROTOCOL_ERROR_CODE = "SOCKET_PROTOCOL_UNSUPPORTED";

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

export function getSocketProtocolErrorMessage(error: unknown): string | null {
  if (!error || typeof error !== "object") return null;
  const data = (error as { data?: unknown }).data;
  if (!data || typeof data !== "object" || Array.isArray(data)) return null;
  if ((data as { code?: unknown }).code !== SOCKET_PROTOCOL_ERROR_CODE) {
    return null;
  }
  return "Yeni bir oyun sürümü hazır. Devam etmek için sayfayı yenileyin.";
}
