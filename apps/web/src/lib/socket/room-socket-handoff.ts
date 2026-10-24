import type { Socket } from "socket.io-client";

// The home page and the dashboard join a room on their own socket and then
// navigate to the room page. Disconnecting that socket and joining again from
// the room page showed the player offline for a moment, long enough for a host
// pressing Start to get NOT_ENOUGH_PLAYERS. The joining page hands the socket
// over instead, and the room page continues on it, so the server never sees
// the player leave.

/** A socket the room page has not picked up by then is closed (the navigation failed or went elsewhere). */
export const ROOM_SOCKET_HANDOFF_TTL_MS = 30_000;

interface PendingRoomSocket {
    roomCode: string;
    socket: Socket;
    timer: ReturnType<typeof setTimeout>;
}

let pending: PendingRoomSocket | null = null;

function normalizeRoomCode(roomCode: string): string {
    return roomCode.trim().toUpperCase();
}

/**
 * Parks a socket that has just joined `roomCode` for the room page. The previous page's
 * listeners are removed, so later room events no longer reach that page.
 */
export function handOffRoomSocket(
    roomCode: string,
    socket: Socket,
    ttlMs: number = ROOM_SOCKET_HANDOFF_TTL_MS
): void {
    if (pending?.socket === socket) {
        clearTimeout(pending.timer);
        pending = null;
    }
    discardPendingRoomSocket();
    socket.removeAllListeners();
    const timer = setTimeout(() => {
        if (pending?.socket === socket) {
            pending = null;
            socket.disconnect();
        }
    }, ttlMs);
    pending = { roomCode: normalizeRoomCode(roomCode), socket, timer };
}

/**
 * Returns the parked socket when it joined `roomCode` and is still connected or
 * reconnecting. Any other parked socket is closed, so a stale join never stays online.
 */
export function adoptRoomSocket(roomCode: string): Socket | null {
    const handoff = pending;
    if (!handoff) {
        return null;
    }
    pending = null;
    clearTimeout(handoff.timer);
    if (handoff.roomCode !== normalizeRoomCode(roomCode) || !handoff.socket.active) {
        handoff.socket.disconnect();
        return null;
    }
    return handoff.socket;
}

/** Closes a parked socket that nobody picked up. */
export function discardPendingRoomSocket(): void {
    const handoff = pending;
    if (!handoff) {
        return;
    }
    pending = null;
    clearTimeout(handoff.timer);
    handoff.socket.disconnect();
}
