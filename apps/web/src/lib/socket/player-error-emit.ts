import {
    getPlayerErrorMessage,
    playerError,
    type PlayerErrorBody,
} from "@/lib/errors/player-error";
import type { PlayerErrorCode, PlayerErrorParams } from "@/lib/errors/player-error-codes";

/** Server -> client error event. Kept under its original name so open tabs from older releases still listen. */
export const SOCKET_ERROR_EVENT = "hata";

/** Second `hata` argument. Clients from before error codes ignore it and show the first (Turkish) argument. */
export interface SocketPlayerErrorMeta {
    code: PlayerErrorCode;
    params?: PlayerErrorParams;
    /** The message is operator-written text (maintenance/capacity notice), not the dictionary text. */
    custom?: true;
}

export interface SocketPlayerErrorOptions {
    params?: PlayerErrorParams;
    /** Operator-written text that replaces the dictionary text for Turkish viewers. */
    customMessage?: string | null;
}

interface SocketErrorTarget {
    emit(event: string, ...args: unknown[]): unknown;
}

export function buildSocketPlayerError(
    code: PlayerErrorCode,
    options: SocketPlayerErrorOptions = {}
): { message: string; meta: SocketPlayerErrorMeta } {
    const customMessage = options.customMessage?.trim() || null;
    const params =
        options.params && Object.keys(options.params).length > 0 ? { ...options.params } : undefined;
    const meta: SocketPlayerErrorMeta = { code };
    if (params) meta.params = params;
    if (customMessage) meta.custom = true;
    return {
        message: customMessage ?? getPlayerErrorMessage(code, params),
        meta,
    };
}

/** Emits `hata` as `(message, { code, params, custom })` to one socket or a room broadcast. */
export function emitPlayerError(
    target: SocketErrorTarget,
    code: PlayerErrorCode,
    options?: SocketPlayerErrorOptions
): void {
    const { message, meta } = buildSocketPlayerError(code, options);
    target.emit(SOCKET_ERROR_EVENT, message, meta);
}

/** Failure acknowledgement for socket callbacks: `{ ok: false, error, code, params? }`. */
export function playerErrorAck(
    code: PlayerErrorCode,
    params?: PlayerErrorParams
): { ok: false } & PlayerErrorBody {
    return { ok: false, ...playerError(code, params) };
}
