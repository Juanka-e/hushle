"use client";

// The guest token lives in this tab's sessionStorage and is dropped as soon as the tab
// joins a room signed in, so the claim keeps its own copy until the server answers.
const GUEST_TOKEN_KEY = "tabu_guestToken";
const PENDING_CLAIM_KEY = "tabu_pendingGuestClaim";
// Sign-up or sign-in normally finishes within minutes; a short life keeps an abandoned
// copy on a shared browser from reaching whoever signs in next in this tab.
const PENDING_CLAIM_MAX_AGE_MS = 2 * 60 * 60 * 1000;

type ClaimStorage = Pick<Storage, "getItem" | "setItem" | "removeItem">;

function sessionStore(): ClaimStorage | null {
  try {
    return window.sessionStorage;
  } catch {
    return null;
  }
}

/** Remembers the current guest identity for a claim after sign-up or sign-in. */
export function stashGuestClaimToken(storage: ClaimStorage | null = sessionStore(), now = Date.now()): boolean {
  try {
    const token = storage?.getItem(GUEST_TOKEN_KEY);
    if (!storage || !token) return false;
    storage.setItem(PENDING_CLAIM_KEY, JSON.stringify({ token, savedAt: now }));
    return true;
  } catch {
    return false;
  }
}

export function readPendingGuestClaim(storage: ClaimStorage | null = sessionStore(), now = Date.now()): string | null {
  let raw: string | null;
  try {
    raw = storage?.getItem(PENDING_CLAIM_KEY) ?? null;
  } catch {
    return null;
  }
  if (!raw) return null;
  try {
    const parsed = JSON.parse(raw) as { token?: unknown; savedAt?: unknown };
    if (
      typeof parsed.token === "string" &&
      parsed.token.length > 0 &&
      typeof parsed.savedAt === "number" &&
      now - parsed.savedAt < PENDING_CLAIM_MAX_AGE_MS
    ) {
      return parsed.token;
    }
  } catch {
    // Corrupt copy: drop it below.
  }
  clearPendingGuestClaim(storage);
  return null;
}

export function clearPendingGuestClaim(storage: ClaimStorage | null = sessionStore()): void {
  try {
    storage?.removeItem(PENDING_CLAIM_KEY);
  } catch {
    // Storage can be blocked; the stale copy then expires on its own.
  }
}
