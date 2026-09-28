import type { Server } from "socket.io";

type GlobalWithSocketServer = typeof globalThis & {
    __hushleSocketServer?: Server;
};

function userSessionRoom(userId: number): string {
    return `private:user-session:${userId}`;
}

export function registerSocketServer(io: Server): void {
    (globalThis as GlobalWithSocketServer).__hushleSocketServer = io;
}

export function joinUserSessionRoom(
    socket: { join(room: string): void | Promise<void> },
    userId: number
): void {
    void socket.join(userSessionRoom(userId));
}

export async function disconnectUserSockets(userId: number): Promise<boolean> {
    const io = (globalThis as GlobalWithSocketServer).__hushleSocketServer;
    if (!io) return false;
    io.in(userSessionRoom(userId)).disconnectSockets(true);
    return true;
}
