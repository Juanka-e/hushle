import assert from "node:assert/strict";
import { setTimeout as sleep } from "node:timers/promises";
import type { Socket } from "socket.io-client";
import {
    ROOM_SOCKET_HANDOFF_TTL_MS,
    adoptRoomSocket,
    discardPendingRoomSocket,
    handOffRoomSocket,
} from "../apps/web/src/lib/socket/room-socket-handoff";

class FakeSocket {
    active = true;
    connected = true;
    disconnects = 0;
    listenerResets = 0;

    disconnect(): this {
        this.disconnects += 1;
        this.active = false;
        this.connected = false;
        return this;
    }

    removeAllListeners(): this {
        this.listenerResets += 1;
        return this;
    }
}

function fakeSocket(): FakeSocket & Socket {
    return new FakeSocket() as FakeSocket & Socket;
}

assert.ok(ROOM_SOCKET_HANDOFF_TTL_MS >= 10_000, "the room page needs time to load and fetch a captcha token");
assert.equal(adoptRoomSocket("ABC123"), null, "nothing is handed over before a join");

{
    const socket = fakeSocket();
    handOffRoomSocket("abc123", socket);
    assert.equal(socket.listenerResets, 1, "the joining page's listeners are removed");
    assert.equal(adoptRoomSocket(" ABC123 "), socket, "the room page takes the socket whatever the code's case");
    assert.equal(socket.disconnects, 0, "an adopted socket stays connected");
    assert.equal(adoptRoomSocket("ABC123"), null, "a socket is handed over once");
}

{
    const socket = fakeSocket();
    handOffRoomSocket("ABC123", socket);
    assert.equal(adoptRoomSocket("XYZ789"), null, "another room's page does not take the socket");
    assert.equal(socket.disconnects, 1, "a socket joined to another room is closed");
    assert.equal(adoptRoomSocket("ABC123"), null, "a closed socket is not handed over later");
}

{
    const socket = fakeSocket();
    handOffRoomSocket("ABC123", socket);
    socket.active = false;
    socket.connected = false;
    assert.equal(adoptRoomSocket("ABC123"), null, "a socket the server closed is not reused");
    assert.equal(socket.disconnects, 1);
}

{
    const socket = fakeSocket();
    handOffRoomSocket("ABC123", socket);
    socket.connected = false;
    assert.equal(adoptRoomSocket("ABC123"), socket, "a reconnecting socket is reused; its next connect rejoins");
}

{
    const first = fakeSocket();
    const second = fakeSocket();
    handOffRoomSocket("ABC123", first);
    handOffRoomSocket("XYZ789", second);
    assert.equal(first.disconnects, 1, "a newer join closes the socket nobody picked up");
    assert.equal(adoptRoomSocket("XYZ789"), second);
    assert.equal(second.disconnects, 0);
}

{
    const socket = fakeSocket();
    handOffRoomSocket("ABC123", socket);
    handOffRoomSocket("ABC123", socket);
    assert.equal(socket.disconnects, 0, "handing the same socket over again keeps it");
    assert.equal(adoptRoomSocket("ABC123"), socket);
}

{
    const socket = fakeSocket();
    handOffRoomSocket("ABC123", socket);
    discardPendingRoomSocket();
    assert.equal(socket.disconnects, 1, "a discarded socket is closed");
    assert.equal(adoptRoomSocket("ABC123"), null);
    discardPendingRoomSocket();
    assert.equal(socket.disconnects, 1, "discarding with nothing parked does nothing");
}

async function checkExpiry(): Promise<void> {
    const expired = fakeSocket();
    handOffRoomSocket("ABC123", expired, 20);
    await sleep(60);
    assert.equal(expired.disconnects, 1, "a socket the room page never picked up is closed");
    assert.equal(adoptRoomSocket("ABC123"), null, "an expired socket is not handed over");

    const adopted = fakeSocket();
    handOffRoomSocket("ABC123", adopted, 20);
    assert.equal(adoptRoomSocket("ABC123"), adopted);
    await sleep(60);
    assert.equal(adopted.disconnects, 0, "the expiry timer is cancelled once the room page takes the socket");

    const replaced = fakeSocket();
    const replacement = fakeSocket();
    handOffRoomSocket("ABC123", replaced, 20);
    handOffRoomSocket("ABC123", replacement, 1_000);
    await sleep(60);
    assert.equal(replacement.disconnects, 0, "an older socket's timer does not close its replacement");
    assert.equal(adoptRoomSocket("ABC123"), replacement);
}

checkExpiry()
    .then(() => console.log("Room socket handoff checks passed."))
    .catch((error: unknown) => {
        console.error(error);
        process.exit(1);
    });
