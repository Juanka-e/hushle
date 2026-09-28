import assert from "node:assert/strict";
import {
  clearActiveRoomPresenceTab,
  getFreshActiveRoomCodeFromPresence,
  readActiveRoomPresence,
  writeActiveRoomPresence,
} from "../apps/web/src/lib/client/active-room-presence";

class MemoryStorage {
  private readonly store = new Map<string, string>();

  getItem(key: string): string | null {
    return this.store.get(key) ?? null;
  }

  setItem(key: string, value: string): void {
    this.store.set(key, value);
  }

  removeItem(key: string): void {
    this.store.delete(key);
  }
}

function run(): void {
  const storage = new MemoryStorage();
  const storageKey = "tabu_active_room_presence:42";

  writeActiveRoomPresence(storageKey, storage, "ROOM01", "tab-a");
  writeActiveRoomPresence(storageKey, storage, "ROOM01", "tab-b");

  const initialRecord = readActiveRoomPresence(storageKey, storage);
  assert.ok(initialRecord);
  assert.equal(initialRecord.roomCode, "ROOM01");
  assert.deepEqual(Object.keys(initialRecord.tabs).sort(), ["tab-a", "tab-b"]);
  assert.equal(getFreshActiveRoomCodeFromPresence(storageKey, storage), "ROOM01");

  clearActiveRoomPresenceTab(storageKey, storage, "tab-a");
  const partiallyClearedRecord = readActiveRoomPresence(storageKey, storage);
  assert.ok(partiallyClearedRecord);
  assert.deepEqual(Object.keys(partiallyClearedRecord.tabs), ["tab-b"]);
  assert.equal(getFreshActiveRoomCodeFromPresence(storageKey, storage), "ROOM01");

  clearActiveRoomPresenceTab(storageKey, storage, "tab-b");
  assert.equal(readActiveRoomPresence(storageKey, storage), null);
  assert.equal(getFreshActiveRoomCodeFromPresence(storageKey, storage), null);

  console.log("active-room-presence smoke test passed");
}

run();
