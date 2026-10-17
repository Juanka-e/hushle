import { useCallback, useEffect, useRef, useState } from "react";
import type { LabRangeDays } from "@/components/admin/lab/lab-card-parts";

/**
 * Loads a Lab card summary for the selected 7/30 day range. A new request (range switch
 * or refresh) aborts the one in flight and only the latest request may touch the state,
 * so a slow refresh can never paint stale data over a newer range.
 */
export function useLabSummary<T extends { days: number }>({
    url,
    isSummary,
    fallbackError,
}: {
    /** Must be stable (module level), it is a dependency of the loader. */
    url: (days: LabRangeDays) => string;
    isSummary: (value: unknown) => value is T;
    fallbackError: string;
}) {
    const [days, setDays] = useState<LabRangeDays>(7);
    const [summary, setSummary] = useState<T | null>(null);
    const [loading, setLoading] = useState(true);
    const [loadError, setLoadError] = useState<string | null>(null);
    const latestRequest = useRef(0);
    const inFlight = useRef<AbortController | null>(null);

    const load = useCallback(
        async (range: LabRangeDays) => {
            inFlight.current?.abort();
            const controller = new AbortController();
            inFlight.current = controller;
            const requestId = ++latestRequest.current;
            const isLatest = () => requestId === latestRequest.current;
            setLoading(true);
            setLoadError(null);
            try {
                const response = await fetch(url(range), {
                    cache: "no-store",
                    signal: controller.signal,
                });
                const payload = (await response.json().catch(() => null)) as unknown;
                if (!response.ok || !isSummary(payload)) {
                    const message =
                        payload && typeof payload === "object" && "error" in payload
                            ? String((payload as { error: unknown }).error)
                            : null;
                    throw new Error(message || fallbackError);
                }
                if (isLatest()) setSummary(payload);
            } catch (error) {
                if (!isLatest()) return;
                if (error instanceof DOMException && error.name === "AbortError") return;
                setLoadError(error instanceof Error && error.message ? error.message : fallbackError);
            } finally {
                if (isLatest()) setLoading(false);
            }
        },
        [url, isSummary, fallbackError]
    );

    useEffect(() => {
        void load(days);
    }, [days, load]);

    useEffect(
        () => () => {
            // Unmount: drop the request in flight and ignore whatever it returns.
            latestRequest.current += 1;
            inFlight.current?.abort();
        },
        []
    );

    const reload = useCallback(() => load(days), [days, load]);

    return { days, setDays, summary, loading, loadError, reload };
}
