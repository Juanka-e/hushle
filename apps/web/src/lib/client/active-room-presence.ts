"use client";

export interface ActiveRoomPresenceRecord {
  roomCode: string;
  tabs: Record<string, number>;
}

const ACTIVE_ROOM_PRESENCE_STALE_MS = 15_000;

function prunePresenceRecord(record: ActiveRoomPresenceRecord, now: number): ActiveRoomPresenceRecord | null {
  const tabs = Object.fromEntries(
    Object.entries(record.tabs).filter(([, updatedAt]) => now - updatedAt < ACTIVE_ROOM_PRESENCE_STALE_MS)
  );

  if (Object.keys(tabs).length === 0) {
    return null;
  }

  return {
    roomCode: record.roomCode,
    tabs,
  };
}

export function readActiveRoomPresence(
  storageKey: string,
  storage: Pick<Storage, "getItem" | "removeItem">
): ActiveRoomPresenceRecord | null {
  const rawPresence = storage.getItem(storageKey);
  if (!rawPresence) {
    return null;
  }

  try {
    const parsed = JSON.parse(rawPresence) as {
      roomCode?: unknown;
      tabs?: unknown;
    };

    if (typeof parsed.roomCode !== "string" || parsed.roomCode.length === 0 || typeof parsed.tabs !== "object" || parsed.tabs === null) {
      storage.removeItem(storageKey);
      return null;
    }

    const tabs = Object.entries(parsed.tabs as Record<string, unknown>).reduce<Record<string, number>>(
      (accumulator, [tabId, updatedAt]) => {
        if (tabId.length > 0 && typeof updatedAt === "number" && Number.isFinite(updatedAt)) {
          accumulator[tabId] = updatedAt;
        }
        return accumulator;
      },
      {}
    );

    const nextRecord = prunePresenceRecord(
      {
        roomCode: parsed.roomCode,
        tabs,
      },
      Date.now()
    );

    if (!nextRecord) {
      storage.removeItem(storageKey);
      return null;
    }

    return nextRecord;
  } catch {
    storage.removeItem(storageKey);
    return null;
  }
}

export function writeActiveRoomPresence(
  storageKey: string,
  storage: Pick<Storage, "getItem" | "setItem" | "removeItem">,
  roomCode: string,
  tabId: string
): ActiveRoomPresenceRecord {
  const currentRecord = readActiveRoomPresence(storageKey, storage);
  const nextRecord: ActiveRoomPresenceRecord = {
    roomCode,
    tabs: {
      ...(currentRecord?.roomCode === roomCode ? currentRecord.tabs : {}),
      [tabId]: Date.now(),
    },
  };

  storage.setItem(storageKey, JSON.stringify(nextRecord));
  return nextRecord;
}

export function clearActiveRoomPresenceTab(
  storageKey: string,
  storage: Pick<Storage, "getItem" | "setItem" | "removeItem">,
  tabId: string
): void {
  const currentRecord = readActiveRoomPresence(storageKey, storage);
  if (!currentRecord) {
    return;
  }

  const nextTabs = Object.fromEntries(Object.entries(currentRecord.tabs).filter(([currentTabId]) => currentTabId !== tabId));

  if (Object.keys(nextTabs).length === 0) {
    storage.removeItem(storageKey);
    return;
  }

  storage.setItem(
    storageKey,
    JSON.stringify({
      roomCode: currentRecord.roomCode,
      tabs: nextTabs,
    } satisfies ActiveRoomPresenceRecord)
  );
}

export function getFreshActiveRoomCodeFromPresence(
  storageKey: string,
  storage: Pick<Storage, "getItem" | "removeItem">
): string | null {
  return readActiveRoomPresence(storageKey, storage)?.roomCode ?? null;
}
