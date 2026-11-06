// Two small checks shared by the stream screen and the streamer panel: whether a string is a
// view key, and which states are newer than the last one taken. No imports, no DOM, no socket:
// the panel reaches them without pulling in the screen's renderer or transport.

/** The public room's capability key: 32 random bytes in base64url. */
export function isViewKey(value: string): boolean {
    return /^[A-Za-z0-9_-]{43}$/.test(value);
}

/** Drops any state that is not newer than the last one taken. */
export function createRevisionGuard() {
    let last = -1;
    return {
        accept(revision: number): boolean {
            if (revision <= last) return false;
            last = revision;
            return true;
        },
        /** The join ack is the new floor (the server's count may have started over). */
        reset(revision: number): void {
            last = revision;
        },
    };
}
