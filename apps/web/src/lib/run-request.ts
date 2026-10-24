/**
 * Applies the outcome of a client request to component state from promise callbacks.
 *
 * Effects use `startRequest`: nothing is set synchronously in the effect body (the
 * react-hooks set-state-in-effect rule), and the returned cancel function, used as the
 * effect cleanup, drops the response of a request whose dependencies have changed.
 * Event handlers that need to wait (a refresh after a save) use `runRequest`.
 * A loading flag that must turn on with the request is set by the caller: in the handler,
 * or during render when the request key changes.
 */
export interface RequestHandlers<T> {
    /** Receives the result. */
    apply: (value: T) => void;
    /** Receives the error of the request or of `apply`. */
    fail?: (error: unknown) => void;
    /** Runs last, after `apply` or `fail`. */
    settle?: () => void;
}

export async function runRequest<T>(
    request: () => Promise<T>,
    handlers: RequestHandlers<T>,
    isCancelled: () => boolean = () => false
): Promise<void> {
    try {
        const value = await request();
        if (!isCancelled()) handlers.apply(value);
    } catch (error) {
        if (!isCancelled()) handlers.fail?.(error);
    } finally {
        if (!isCancelled()) handlers.settle?.();
    }
}

/** Starts the request and returns the cancel function for the effect cleanup. */
export function startRequest<T>(request: () => Promise<T>, handlers: RequestHandlers<T>): () => void {
    let cancelled = false;
    void runRequest(request, handlers, () => cancelled);
    return () => {
        cancelled = true;
    };
}
