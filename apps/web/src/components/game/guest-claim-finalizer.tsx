"use client";

import { useEffect, useRef } from "react";
import { useSession } from "next-auth/react";
import { toast } from "sonner";
import { useI18n } from "@/components/providers/i18n-provider";
import {
  clearPendingGuestClaim,
  readPendingGuestClaim,
} from "@/lib/client/guest-claim-storage";
import type { GuestClaimSummary } from "@/lib/match-settlement/guest-claim-rules";

type Translate = ReturnType<typeof useI18n>["t"];

/** Tells the player what happened to the guest matches they asked to keep. */
export function announceGuestClaim(summary: GuestClaimSummary, t: Translate): void {
  if (summary.status === "invalid_token") {
    toast.error(t("guestClaim.expired"));
  } else if (summary.status === "linked_elsewhere") {
    toast.error(t("guestClaim.linkedElsewhere"));
  } else if (summary.settledNow > 0) {
    toast.success(
      summary.coinEarnedNow > 0
        ? t("guestClaim.settledWithCoin", { count: summary.settledNow, coin: summary.coinEarnedNow })
        : t("guestClaim.settled", { count: summary.settledNow })
    );
  } else if (summary.awaitingVerification > 0) {
    toast.info(t("guestClaim.awaitingVerification"));
  }
}

/**
 * Finishes a "keep this match" request once the tab is signed in. Final answers clear
 * the request; rate limits, outages and lost sessions leave it for the next page load.
 */
export function GuestClaimFinalizer() {
  const { status } = useSession();
  const { t } = useI18n();
  const inFlight = useRef(false);

  useEffect(() => {
    if (status !== "authenticated" || inFlight.current) return;
    const guestToken = readPendingGuestClaim();
    if (!guestToken) return;

    inFlight.current = true;
    void fetch("/api/game/match/guest-claims", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ guestToken }),
    })
      .then(async (response) => {
        if (response.ok) {
          clearPendingGuestClaim();
          announceGuestClaim((await response.json()) as GuestClaimSummary, t);
        } else if (response.status === 400) {
          clearPendingGuestClaim();
          announceGuestClaim({ ...EMPTY_SUMMARY, status: "invalid_token" }, t);
        } else if (response.status === 409) {
          clearPendingGuestClaim();
          announceGuestClaim({ ...EMPTY_SUMMARY, status: "linked_elsewhere" }, t);
        }
      })
      .catch(() => undefined)
      .finally(() => {
        inFlight.current = false;
      });
  }, [status, t]);

  return null;
}

const EMPTY_SUMMARY: GuestClaimSummary = {
  status: "ok",
  matches: 0,
  settledNow: 0,
  coinEarnedNow: 0,
  awaitingVerification: 0,
  alreadyMoved: 0,
};
