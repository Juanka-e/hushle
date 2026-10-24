import { useSyncExternalStore } from "react";

const subscribeToNothing = () => () => undefined;

/**
 * False on the server and during hydration, true afterwards. Lets a component render
 * browser-only values without a hydration mismatch and without a "mounted" effect.
 */
export function useHydrated(): boolean {
    return useSyncExternalStore(subscribeToNothing, () => true, () => false);
}
