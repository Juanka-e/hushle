// The clock and timers the stream session runtime and its writes run on. Production uses the
// real ones; tests inject their own so a bound or an interval fires when the test says so.

export interface StreamerTimers {
    /** Wall-clock milliseconds, for the bound of a wait (the game clock is the runtime's `now`). */
    now(): number;
    setTimeout(run: () => void, ms: number): unknown;
    clearTimeout(handle: unknown): void;
    /** A background interval: it never keeps the process up on its own. */
    setInterval(run: () => void, ms: number): unknown;
    clearInterval(handle: unknown): void;
}

export const realStreamerTimers: StreamerTimers = {
    now: () => Date.now(),
    setTimeout: (run, ms) => setTimeout(run, ms),
    clearTimeout: (handle) => clearTimeout(handle as ReturnType<typeof setTimeout>),
    setInterval(run, ms) {
        const handle = setInterval(run, ms);
        handle.unref?.();
        return handle;
    },
    clearInterval: (handle) => clearInterval(handle as ReturnType<typeof setInterval>),
};
