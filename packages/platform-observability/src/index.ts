const REQUEST_ID_PATTERN = /^[A-Za-z0-9._:-]{1,64}$/;
const EVENT_NAME_PATTERN = /^[a-z0-9][a-z0-9._-]{0,79}$/;
const SENSITIVE_KEY_PATTERN = /(?:authorization|cookie|credential|email|password|secret|session|token)/i;
const EMAIL_PATTERN = /\b[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}\b/gi;
const BEARER_PATTERN = /\bBearer\s+[A-Za-z0-9._~+/=-]+/gi;
const URL_CREDENTIAL_PATTERN = /(\w+:\/\/)[^\s/@:]+:[^\s/@]+@/gi;
const KEY_VALUE_SECRET_PATTERN = /\b(password|secret|token|api[_-]?key)\s*[=:]\s*[^\s,;]+/gi;

export type ObservabilityLevel = "info" | "warn" | "error";
export type SafeContextValue = string | number | boolean | null | SafeContextValue[];

export interface ObservabilityEvent {
    eventId: string;
    timestamp: string;
    level: ObservabilityLevel;
    service: string;
    environment: string;
    event: string;
    requestId?: string;
    message?: string;
    error?: {
        type: string;
        message: string;
        stack?: string;
    };
    context?: Record<string, SafeContextValue>;
}

export interface ObservabilityExporter {
    capture(event: ObservabilityEvent): void | Promise<void>;
    flush?(): void | Promise<void>;
    dispose?(): void;
    getStatus?(): ObservabilityExporterDeliveryStatus;
}

export interface ObservabilityExporterDeliveryStatus {
    queued: number;
    delivered: number;
    dropped: number;
    lastDeliveryAt: string | null;
}

export interface ObservabilityStatus {
    emitted: number;
    errors: number;
    warnings: number;
    exporterConfigured: boolean;
    exporterMode: "disabled" | "custom" | "http";
    exporterFailures: number;
    exporterQueued: number;
    exporterDelivered: number;
    exporterDropped: number;
    lastExportAt: string | null;
    droppedContextFields: number;
    lastErrorAt: string | null;
}

interface ObservabilityState extends ObservabilityStatus {
    exporter: ObservabilityExporter | null;
    exporterConfigSignature: string | null;
    sink: (level: ObservabilityLevel, line: string) => void;
}

type ObservabilityGlobal = typeof globalThis & {
    __hushleObservabilityState?: ObservabilityState;
};

function defaultSink(level: ObservabilityLevel, line: string): void {
    if (level === "error") console.error(line);
    else if (level === "warn") console.warn(line);
    else console.log(line);
}

function getState(): ObservabilityState {
    const observabilityGlobal = globalThis as ObservabilityGlobal;
    observabilityGlobal.__hushleObservabilityState ??= {
        emitted: 0,
        errors: 0,
        warnings: 0,
        exporterConfigured: false,
        exporterMode: "disabled",
        exporterFailures: 0,
        exporterQueued: 0,
        exporterDelivered: 0,
        exporterDropped: 0,
        lastExportAt: null,
        droppedContextFields: 0,
        lastErrorAt: null,
        exporter: null,
        exporterConfigSignature: null,
        sink: defaultSink,
    };
    return observabilityGlobal.__hushleObservabilityState;
}

export function isValidRequestId(value: string | null | undefined): value is string {
    return typeof value === "string" && REQUEST_ID_PATTERN.test(value);
}

export function getOrCreateRequestId(value?: string | null): string {
    return isValidRequestId(value) ? value : crypto.randomUUID();
}

function redactString(value: string, maxLength = 500): string {
    return value
        .replace(EMAIL_PATTERN, "[redacted-email]")
        .replace(BEARER_PATTERN, "Bearer [redacted]")
        .replace(URL_CREDENTIAL_PATTERN, "$1[redacted]@")
        .replace(KEY_VALUE_SECRET_PATTERN, "$1=[redacted]")
        .slice(0, maxLength);
}

function sanitizeContextValue(
    value: unknown,
    depth = 0
): SafeContextValue | undefined {
    if (value === null || typeof value === "boolean") return value;
    if (typeof value === "number") return Number.isFinite(value) ? value : undefined;
    if (typeof value === "string") return redactString(value, 200);
    if (Array.isArray(value)) {
        if (depth >= 2) return undefined;
        const values = value
            .slice(0, 10)
            .map((entry) => sanitizeContextValue(entry, depth + 1))
            .filter((entry): entry is SafeContextValue => entry !== undefined);
        return values;
    }
    return undefined;
}

export function sanitizeObservabilityContext(
    context: Record<string, unknown> | undefined
): Record<string, SafeContextValue> | undefined {
    if (!context) return undefined;
    const state = getState();
    const result: Record<string, SafeContextValue> = {};
    for (const [key, rawValue] of Object.entries(context).slice(0, 24)) {
        if (SENSITIVE_KEY_PATTERN.test(key)) {
            state.droppedContextFields += 1;
            continue;
        }
        const value = sanitizeContextValue(rawValue);
        if (value === undefined) {
            state.droppedContextFields += 1;
            continue;
        }
        result[key.slice(0, 64)] = value;
    }
    return Object.keys(result).length > 0 ? result : undefined;
}

function normalizeError(error: unknown): ObservabilityEvent["error"] {
    if (!(error instanceof Error)) {
        return { type: "UnknownError", message: "Unknown runtime error" };
    }
    return {
        type: redactString(error.name || "Error", 80),
        message: redactString(error.message || "Runtime error"),
        ...(error.stack ? { stack: redactString(error.stack, 4_000) } : {}),
    };
}

function normalizeName(value: string, fallback: string): string {
    const normalized = value.trim().toLowerCase();
    return EVENT_NAME_PATTERN.test(normalized) ? normalized : fallback;
}

export function configureObservabilityExporter(
    exporter: ObservabilityExporter | null
): void {
    const state = getState();
    if (state.exporter !== exporter) state.exporter?.dispose?.();
    state.exporter = exporter;
    state.exporterConfigured = exporter !== null;
    state.exporterMode = exporter === null ? "disabled" : "custom";
    state.exporterConfigSignature = null;
}

interface HttpExporterConfig {
    endpoint: string;
    token: string;
    batchSize: number;
    queueLimit: number;
    flushIntervalMs: number;
    timeoutMs: number;
}

class HttpBatchObservabilityExporter implements ObservabilityExporter {
    private readonly queue: ObservabilityEvent[] = [];
    private delivered = 0;
    private dropped = 0;
    private lastDeliveryAt: string | null = null;
    private inFlight: Promise<void> | null = null;
    private readonly interval: ReturnType<typeof setInterval>;

    constructor(
        private readonly config: HttpExporterConfig,
        private readonly onBackgroundFailure: () => void
    ) {
        this.interval = setInterval(() => {
            this.startBackgroundDelivery(true);
        }, config.flushIntervalMs);
        this.interval.unref?.();
    }

    capture(event: ObservabilityEvent): void {
        if (this.queue.length >= this.config.queueLimit) {
            this.dropped += 1;
            return;
        }
        this.queue.push(event);
        if (this.queue.length >= this.config.batchSize) {
            this.startBackgroundDelivery(false);
        }
    }

    async flush(): Promise<void> {
        if (this.inFlight) await this.inFlight;
        while (this.queue.length > 0) await this.sendOneBatch();
    }

    dispose(): void {
        clearInterval(this.interval);
    }

    getStatus(): ObservabilityExporterDeliveryStatus {
        return {
            queued: this.queue.length,
            delivered: this.delivered,
            dropped: this.dropped,
            lastDeliveryAt: this.lastDeliveryAt,
        };
    }

    private startBackgroundDelivery(force: boolean): void {
        if (
            this.inFlight ||
            this.queue.length === 0 ||
            (!force && this.queue.length < this.config.batchSize)
        ) {
            return;
        }
        void this.sendOneBatch()
            .then(() => this.startBackgroundDelivery(false))
            .catch(this.onBackgroundFailure);
    }

    private sendOneBatch(): Promise<void> {
        if (this.inFlight) return this.inFlight;
        if (this.queue.length === 0) return Promise.resolve();

        const batch = this.queue.splice(0, this.config.batchSize);
        this.inFlight = this.deliver(batch).finally(() => {
            this.inFlight = null;
        });
        return this.inFlight;
    }

    private async deliver(batch: ObservabilityEvent[]): Promise<void> {
        const controller = new AbortController();
        const timeout = setTimeout(() => controller.abort(), this.config.timeoutMs);
        try {
            const response = await fetch(this.config.endpoint, {
                method: "POST",
                headers: {
                    authorization: `Bearer ${this.config.token}`,
                    "content-type": "application/json",
                },
                body: JSON.stringify({
                    schemaVersion: 1,
                    sentAt: new Date().toISOString(),
                    events: batch,
                }),
                redirect: "error",
                signal: controller.signal,
            });
            if (!response.ok) {
                throw new Error(`observability_export_http_${response.status}`);
            }
            if (response.body) {
                await response.body.cancel().catch(() => undefined);
            }
            this.delivered += batch.length;
            this.lastDeliveryAt = new Date().toISOString();
        } catch (error) {
            this.queue.unshift(...batch);
            while (this.queue.length > this.config.queueLimit) {
                this.queue.pop();
                this.dropped += 1;
            }
            throw error;
        } finally {
            clearTimeout(timeout);
        }
    }
}

function parseBoundedInteger(
    value: string | undefined,
    fallback: number,
    minimum: number,
    maximum: number
): number {
    const parsed = Number.parseInt(value ?? "", 10);
    return Number.isFinite(parsed)
        ? Math.min(maximum, Math.max(minimum, parsed))
        : fallback;
}

export function configureObservabilityFromEnvironment(
    env: NodeJS.ProcessEnv = process.env
): ObservabilityStatus {
    const mode = env.OBSERVABILITY_EXPORT_MODE?.trim().toLowerCase() ?? "disabled";
    const state = getState();
    if (mode !== "disabled" && mode !== "http") {
        throw new Error("OBSERVABILITY_EXPORT_MODE must be disabled or http");
    }
    if (mode !== "http") {
        if (state.exporterMode !== "disabled") configureObservabilityExporter(null);
        return getObservabilityStatus();
    }

    const endpoint = env.OBSERVABILITY_EXPORT_URL?.trim() ?? "";
    const token = env.OBSERVABILITY_EXPORT_TOKEN?.trim() ?? "";
    const parsedEndpoint = new URL(endpoint);
    if (
        (env.NODE_ENV === "production" && parsedEndpoint.protocol !== "https:") ||
        (env.NODE_ENV === "production" && Boolean(parsedEndpoint.search || parsedEndpoint.hash)) ||
        !["http:", "https:"].includes(parsedEndpoint.protocol) ||
        parsedEndpoint.username ||
        parsedEndpoint.password
    ) {
        throw new Error("Invalid OBSERVABILITY_EXPORT_URL");
    }
    if (!token || (env.NODE_ENV === "production" && token.length < 32)) {
        throw new Error("OBSERVABILITY_EXPORT_TOKEN is missing or too short");
    }

    const config: HttpExporterConfig = {
        endpoint: parsedEndpoint.toString(),
        token,
        batchSize: parseBoundedInteger(env.OBSERVABILITY_EXPORT_BATCH_SIZE, 20, 1, 100),
        queueLimit: parseBoundedInteger(env.OBSERVABILITY_EXPORT_QUEUE_LIMIT, 500, 20, 5_000),
        flushIntervalMs: parseBoundedInteger(
            env.OBSERVABILITY_EXPORT_FLUSH_INTERVAL_MS,
            5_000,
            1_000,
            60_000
        ),
        timeoutMs: parseBoundedInteger(env.OBSERVABILITY_EXPORT_TIMEOUT_MS, 3_000, 500, 10_000),
    };
    const signature = JSON.stringify(config);
    if (state.exporterMode === "http" && state.exporterConfigSignature === signature) {
        return getObservabilityStatus();
    }

    state.exporter?.dispose?.();
    state.exporter = new HttpBatchObservabilityExporter(config, () => {
        state.exporterFailures += 1;
    });
    state.exporterConfigured = true;
    state.exporterMode = "http";
    state.exporterConfigSignature = signature;
    return getObservabilityStatus();
}

export async function emitObservabilityEvent(input: {
    level: ObservabilityLevel;
    service: string;
    event: string;
    requestId?: string | null;
    message?: string;
    error?: unknown;
    context?: Record<string, unknown>;
}): Promise<void> {
    const state = getState();
    const timestamp = new Date().toISOString();
    const context = sanitizeObservabilityContext(input.context);
    const event: ObservabilityEvent = {
        eventId: crypto.randomUUID(),
        timestamp,
        level: input.level,
        service: normalizeName(input.service, "unknown-service"),
        environment: normalizeName(process.env.NODE_ENV ?? "unknown", "unknown"),
        event: normalizeName(input.event, "unknown-event"),
        ...(isValidRequestId(input.requestId) ? { requestId: input.requestId } : {}),
        ...(input.message ? { message: redactString(input.message) } : {}),
        ...(input.error !== undefined ? { error: normalizeError(input.error) } : {}),
        ...(context ? { context } : {}),
    };

    state.emitted += 1;
    if (input.level === "error") {
        state.errors += 1;
        state.lastErrorAt = timestamp;
    } else if (input.level === "warn") {
        state.warnings += 1;
    }
    state.sink(input.level, JSON.stringify(event));

    if (state.exporter) {
        try {
            const capture = state.exporter.capture(event);
            if (capture && typeof capture.then === "function") {
                void capture.catch(() => {
                    state.exporterFailures += 1;
                });
            }
        } catch {
            state.exporterFailures += 1;
        }
    }
}

export async function flushObservabilityExporter(
    timeoutMs = 2_000
): Promise<boolean> {
    const state = getState();
    if (!state.exporter?.flush) return true;

    let timeout: ReturnType<typeof setTimeout> | undefined;
    try {
        await Promise.race([
            Promise.resolve(state.exporter.flush()),
            new Promise<never>((_resolve, reject) => {
                timeout = setTimeout(
                    () => reject(new Error("observability_flush_timeout")),
                    Math.max(1, timeoutMs)
                );
            }),
        ]);
        return true;
    } catch {
        state.exporterFailures += 1;
        return false;
    } finally {
        if (timeout) clearTimeout(timeout);
    }
}

export function reportError(
    input: Omit<Parameters<typeof emitObservabilityEvent>[0], "level">
): Promise<void> {
    return emitObservabilityEvent({ ...input, level: "error" });
}

export function reportWarning(
    input: Omit<
        Parameters<typeof emitObservabilityEvent>[0],
        "level" | "error"
    >
): Promise<void> {
    return emitObservabilityEvent({ ...input, level: "warn" });
}

export function getObservabilityStatus(): ObservabilityStatus {
    const state = getState();
    const delivery = state.exporter?.getStatus?.();
    return {
        emitted: state.emitted,
        errors: state.errors,
        warnings: state.warnings,
        exporterConfigured: state.exporterConfigured,
        exporterMode: state.exporterMode,
        exporterFailures: state.exporterFailures,
        exporterQueued: delivery?.queued ?? 0,
        exporterDelivered: delivery?.delivered ?? 0,
        exporterDropped: delivery?.dropped ?? 0,
        lastExportAt: delivery?.lastDeliveryAt ?? null,
        droppedContextFields: state.droppedContextFields,
        lastErrorAt: state.lastErrorAt,
    };
}

export function resetObservabilityForTests(options?: {
    sink?: (level: ObservabilityLevel, line: string) => void;
}): void {
    const state = getState();
    state.exporter?.dispose?.();
    state.emitted = 0;
    state.errors = 0;
    state.warnings = 0;
    state.exporterConfigured = false;
    state.exporterMode = "disabled";
    state.exporterFailures = 0;
    state.exporterQueued = 0;
    state.exporterDelivered = 0;
    state.exporterDropped = 0;
    state.lastExportAt = null;
    state.droppedContextFields = 0;
    state.lastErrorAt = null;
    state.exporter = null;
    state.exporterConfigSignature = null;
    state.sink = options?.sink ?? defaultSink;
}
