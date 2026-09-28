import { createClient } from "redis";

export type AppRedisClient = ReturnType<typeof createClient>;
type RedisSetOptions = {
    PX?: number;
    NX?: boolean;
};

export interface RedisLikeClient {
    ping(): Promise<string>;
    get(key: string): Promise<string | null>;
    mGet?(keys: string[]): Promise<Array<string | null>>;
    set(key: string, value: string, options?: RedisSetOptions): Promise<string | null>;
    del(key: string): Promise<number>;
    incr(key: string): Promise<number>;
    pExpire(key: string, milliseconds: number): Promise<number>;
    pTTL(key: string): Promise<number>;
    sAdd?(key: string, member: string): Promise<number>;
    sRem?(key: string, member: string): Promise<number>;
    sMembers?(key: string): Promise<string[]>;
    hmGet?(key: string, fields: string[]): Promise<Array<string | null>>;
    eval(
        script: string,
        options: { keys: string[]; arguments: string[] }
    ): Promise<unknown>;
}

export interface RedisHealth {
    configured: boolean;
    available: boolean;
    latencyMs: number | null;
}

export interface OperationalHeartbeat {
    schemaVersion: 1;
    name: string;
    completedAt: string;
    durationMs: number;
}

export interface OperationalHeartbeatReadResult {
    available: boolean;
    heartbeat: OperationalHeartbeat | null;
}

export interface DedicatedRedisConnectionPair {
    publisher: AppRedisClient;
    subscriber: AppRedisClient;
    close(): Promise<void>;
}

export type JsonCacheSource = "redis" | "memory" | "loader";

export interface JsonCacheResult<T> {
    value: T;
    source: JsonCacheSource;
    coalesced: boolean;
}

export interface JsonCacheMetrics {
    redisHits: number;
    memoryHits: number;
    misses: number;
    loads: number;
    coalescedLoads: number;
    writeErrors: number;
    readErrors: number;
    corruptEntries: number;
    invalidations: number;
    memoryEntries: number;
    inFlightLoads: number;
}

interface MemoryCacheEntry {
    value: string;
    expiresAt: number;
}

interface JsonCacheState {
    memory: Map<string, MemoryCacheEntry>;
    inFlight: Map<string, Promise<JsonCacheResult<unknown>>>;
    metrics: Omit<JsonCacheMetrics, "memoryEntries" | "inFlightLoads">;
}

type CacheGlobal = typeof globalThis & {
    __hushleJsonCacheState?: JsonCacheState;
};

let redisClient: AppRedisClient | null = null;
let redisConnectPromise: Promise<AppRedisClient | null> | null = null;
let redisRetryAfter = 0;
let redisTestClient: RedisLikeClient | null = null;

function getRedisUrl(): string | null {
    const url = process.env.REDIS_URL?.trim();
    return url ? url : null;
}

export function getRedisKey(...segments: Array<string | number>): string {
    const prefix = process.env.REDIS_KEY_PREFIX?.trim() || "hushle";
    return [prefix, ...segments].join(":");
}

function parseOperationalHeartbeat(value: string): OperationalHeartbeat | null {
    try {
        const parsed = JSON.parse(value) as Partial<OperationalHeartbeat>;
        if (
            parsed.schemaVersion !== 1
            || typeof parsed.name !== "string"
            || !/^[a-z0-9][a-z0-9-]{0,63}$/.test(parsed.name)
            || typeof parsed.completedAt !== "string"
            || !Number.isFinite(Date.parse(parsed.completedAt))
            || typeof parsed.durationMs !== "number"
            || !Number.isFinite(parsed.durationMs)
            || parsed.durationMs < 0
        ) return null;
        return parsed as OperationalHeartbeat;
    } catch {
        return null;
    }
}

export async function writeOperationalHeartbeat(input: {
    name: string;
    completedAt: Date;
    durationMs: number;
    ttlMs?: number;
}): Promise<void> {
    if (!/^[a-z0-9][a-z0-9-]{0,63}$/.test(input.name)) {
        throw new Error("Invalid operational heartbeat name");
    }
    if (!Number.isFinite(input.durationMs) || input.durationMs < 0) {
        throw new Error("Invalid operational heartbeat duration");
    }
    const client = await getRedisClient();
    if (!client) throw new Error("Redis is required for operational heartbeat");
    const heartbeat: OperationalHeartbeat = {
        schemaVersion: 1,
        name: input.name,
        completedAt: input.completedAt.toISOString(),
        durationMs: Math.round(input.durationMs),
    };
    await client.set(
        getRedisKey("operational-heartbeat", input.name),
        JSON.stringify(heartbeat),
        { PX: input.ttlMs ?? 7 * 24 * 60 * 60_000 }
    );
}

export async function readOperationalHeartbeat(name: string): Promise<OperationalHeartbeatReadResult> {
    if (!/^[a-z0-9][a-z0-9-]{0,63}$/.test(name)) {
        throw new Error("Invalid operational heartbeat name");
    }
    const client = await getRedisClient();
    if (!client) return { available: false, heartbeat: null };
    try {
        const value = await client.get(getRedisKey("operational-heartbeat", name));
        if (value === null) return { available: true, heartbeat: null };
        return { available: true, heartbeat: parseOperationalHeartbeat(value) };
    } catch {
        return { available: false, heartbeat: null };
    }
}

async function closeNativeRedisClient(client: AppRedisClient): Promise<void> {
    if (client.isReady) {
        await client.quit();
    } else if (client.isOpen) {
        client.destroy();
    }
}

export async function createDedicatedRedisConnectionPair(options: {
    url: string;
    connectTimeoutMs?: number;
    maxReconnectAttempts?: number;
    onError?: (error: Error) => void;
}): Promise<DedicatedRedisConnectionPair> {
    const publisher = createClient({
        url: options.url,
        socket: {
            connectTimeout: options.connectTimeoutMs ?? 3_000,
            reconnectStrategy(retries) {
                return retries > (options.maxReconnectAttempts ?? 10)
                    ? false
                    : Math.min(retries * 200, 2_000);
            },
        },
    });
    const subscriber = publisher.duplicate();
    const onError = options.onError ?? (() => undefined);
    publisher.on("error", onError);
    subscriber.on("error", onError);

    try {
        await Promise.all([publisher.connect(), subscriber.connect()]);
    } catch (error) {
        await Promise.allSettled([
            closeNativeRedisClient(publisher),
            closeNativeRedisClient(subscriber),
        ]);
        throw error;
    }

    return {
        publisher,
        subscriber,
        close: async () => {
            await Promise.allSettled([
                closeNativeRedisClient(publisher),
                closeNativeRedisClient(subscriber),
            ]);
        },
    };
}

function getPositiveIntegerSetting(name: string, fallback: number): number {
    const parsed = Number.parseInt(process.env[name] ?? "", 10);
    return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback;
}

function getJsonCacheState(): JsonCacheState {
    const globalState = globalThis as CacheGlobal;
    globalState.__hushleJsonCacheState ??= {
        memory: new Map(),
        inFlight: new Map(),
        metrics: {
            redisHits: 0,
            memoryHits: 0,
            misses: 0,
            loads: 0,
            coalescedLoads: 0,
            writeErrors: 0,
            readErrors: 0,
            corruptEntries: 0,
            invalidations: 0,
        },
    };
    return globalState.__hushleJsonCacheState;
}

function pruneMemoryCache(state: JsonCacheState): void {
    const now = Date.now();
    for (const [key, entry] of state.memory) {
        if (entry.expiresAt <= now) {
            state.memory.delete(key);
        }
    }

    const maximumEntries = getPositiveIntegerSetting(
        "CACHE_MEMORY_MAX_ENTRIES",
        500
    );
    while (state.memory.size > maximumEntries) {
        const oldestKey = state.memory.keys().next().value as
            | string
            | undefined;
        if (!oldestKey) break;
        state.memory.delete(oldestKey);
    }
}

function readMemoryCache<T>(
    state: JsonCacheState,
    key: string
): T | undefined {
    const entry = state.memory.get(key);
    if (!entry) return undefined;
    if (entry.expiresAt <= Date.now()) {
        state.memory.delete(key);
        return undefined;
    }

    try {
        return JSON.parse(entry.value) as T;
    } catch {
        state.memory.delete(key);
        state.metrics.corruptEntries += 1;
        return undefined;
    }
}

function writeMemoryCache(
    state: JsonCacheState,
    key: string,
    value: string,
    ttlMs: number
): void {
    state.memory.delete(key);
    state.memory.set(key, {
        value,
        expiresAt: Date.now() + ttlMs,
    });
    pruneMemoryCache(state);
}

export function isRedisConfigured(): boolean {
    if (redisTestClient) {
        return true;
    }

    return Boolean(getRedisUrl());
}

export async function getOrSetJsonCache<T>(options: {
    key: string;
    ttlMs: number;
    loader: () => Promise<T>;
}): Promise<JsonCacheResult<T>> {
    const key = options.key.trim();
    if (!key) {
        throw new Error("Cache key is required");
    }
    if (!Number.isFinite(options.ttlMs) || options.ttlMs <= 0) {
        throw new Error("Cache TTL must be a positive number");
    }

    const state = getJsonCacheState();
    const client = await getRedisClient();
    let useMemoryFallback = client === null;
    if (client) {
        try {
            const cached = await client.get(key);
            if (cached !== null) {
                try {
                    const value = JSON.parse(cached) as T;
                    state.metrics.redisHits += 1;
                    return {
                        value,
                        source: "redis",
                        coalesced: false,
                    };
                } catch {
                    state.metrics.corruptEntries += 1;
                    await client.del(key).catch(() => {
                        state.metrics.writeErrors += 1;
                    });
                }
            }
        } catch {
            state.metrics.readErrors += 1;
            useMemoryFallback = true;
        }
    }

    if (useMemoryFallback) {
        const memoryValue = readMemoryCache<T>(state, key);
        if (memoryValue !== undefined) {
            state.metrics.memoryHits += 1;
            return {
                value: memoryValue,
                source: "memory",
                coalesced: false,
            };
        }
    }

    state.metrics.misses += 1;
    const existingLoad = state.inFlight.get(key);
    if (existingLoad) {
        state.metrics.coalescedLoads += 1;
        const result = (await existingLoad) as JsonCacheResult<T>;
        return { ...result, coalesced: true };
    }

    const loadPromise = (async (): Promise<JsonCacheResult<T>> => {
        state.metrics.loads += 1;
        const value = await options.loader();
        const serialized = JSON.stringify(value);
        if (serialized === undefined) {
            return { value, source: "loader", coalesced: false };
        }

        if (client && !useMemoryFallback) {
            try {
                await client.set(key, serialized, { PX: options.ttlMs });
            } catch {
                state.metrics.writeErrors += 1;
                writeMemoryCache(state, key, serialized, options.ttlMs);
            }
        } else {
            writeMemoryCache(state, key, serialized, options.ttlMs);
        }

        return { value, source: "loader", coalesced: false };
    })();

    state.inFlight.set(
        key,
        loadPromise as Promise<JsonCacheResult<unknown>>
    );
    try {
        return await loadPromise;
    } finally {
        state.inFlight.delete(key);
    }
}

export async function invalidateJsonCache(key: string): Promise<void> {
    const normalizedKey = key.trim();
    if (!normalizedKey) return;

    const state = getJsonCacheState();
    state.memory.delete(normalizedKey);
    state.metrics.invalidations += 1;

    const client = await getRedisClient();
    if (!client) return;
    try {
        await client.del(normalizedKey);
    } catch {
        state.metrics.writeErrors += 1;
    }
}

export function getJsonCacheMetrics(): JsonCacheMetrics {
    const state = getJsonCacheState();
    pruneMemoryCache(state);
    return {
        ...state.metrics,
        memoryEntries: state.memory.size,
        inFlightLoads: state.inFlight.size,
    };
}

export function resetJsonCacheState(): void {
    const state = getJsonCacheState();
    state.memory.clear();
    state.inFlight.clear();
    for (const key of Object.keys(state.metrics) as Array<
        keyof typeof state.metrics
    >) {
        state.metrics[key] = 0;
    }
}

export async function getRedisClient(): Promise<RedisLikeClient | null> {
    if (redisTestClient) {
        return redisTestClient;
    }

    if (Date.now() < redisRetryAfter) {
        return null;
    }

    if (redisClient?.isReady) {
        return redisClient;
    }

    if (redisConnectPromise) {
        return redisConnectPromise;
    }

    const redisUrl = getRedisUrl();
    if (!redisUrl) {
        return null;
    }

    const client = createClient({
        url: redisUrl,
        socket: {
            connectTimeout: getPositiveIntegerSetting(
                "REDIS_CONNECT_TIMEOUT_MS",
                3_000
            ),
            reconnectStrategy(retries) {
                return retries > 5 ? false : Math.min(retries * 200, 2_000);
            },
        },
    });

    client.on("error", (error) => {
        console.error("Redis client error:", error);
    });

    redisConnectPromise = client
        .connect()
        .then(() => {
            redisClient = client;
            redisRetryAfter = 0;
            return client;
        })
        .catch((error) => {
            console.error("Redis connect failed, falling back to in-memory mode:", error);
            redisRetryAfter =
                Date.now() +
                getPositiveIntegerSetting("REDIS_RETRY_COOLDOWN_MS", 30_000);
            return null;
        })
        .finally(() => {
            redisConnectPromise = null;
        });

    return redisConnectPromise;
}

export async function getRedisHealth(): Promise<RedisHealth> {
    if (!isRedisConfigured()) {
        return {
            configured: false,
            available: false,
            latencyMs: null,
        };
    }

    const startedAt = Date.now();
    const client = await getRedisClient();
    if (!client) {
        return {
            configured: true,
            available: false,
            latencyMs: null,
        };
    }

    try {
        const response = await client.ping();
        return {
            configured: true,
            available: response === "PONG",
            latencyMs: Date.now() - startedAt,
        };
    } catch {
        return {
            configured: true,
            available: false,
            latencyMs: null,
        };
    }
}

export async function closeRedisClient(): Promise<void> {
    const client = redisClient;
    redisClient = null;
    redisConnectPromise = null;
    redisRetryAfter = 0;

    if (client?.isOpen) {
        await client.quit();
    }
}

export function setRedisTestClient(client: RedisLikeClient): void {
    redisTestClient = client;
    redisRetryAfter = 0;
}

export function resetRedisTestClient(): void {
    redisTestClient = null;
    redisRetryAfter = 0;
}
