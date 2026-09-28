import {
    getRedisClient,
    getRedisKey,
    isRedisConfigured,
} from "@hushle/platform-cache";
export { getRequestIp, shouldTrustProxyHeaders } from "@/lib/security/client-ip";

interface RateLimitEntry {
    count: number;
    resetAt: number;
    timeout: ReturnType<typeof setTimeout>;
}

export interface ConsumeRequestRateLimitOptions {
    bucket: string;
    key: string;
    windowMs: number;
    maxRequests: number;
}

export interface RequestRateLimitResult {
    allowed: boolean;
    limit: number;
    remaining: number;
    retryAfterSeconds: number;
}

const rateLimitBuckets = new Map<string, Map<string, RateLimitEntry>>();
let distributedFallbackWarningAt = 0;
const DISTRIBUTED_RATE_LIMIT_SCRIPT = `
local count = redis.call("INCR", KEYS[1])
if count == 1 then
    redis.call("PEXPIRE", KEYS[1], ARGV[1])
end
local ttl = redis.call("PTTL", KEYS[1])
return { count, ttl }
`;

function getBucketStore(bucket: string): Map<string, RateLimitEntry> {
    let store = rateLimitBuckets.get(bucket);
    if (!store) {
        store = new Map<string, RateLimitEntry>();
        rateLimitBuckets.set(bucket, store);
    }

    return store;
}

export function consumeRequestRateLimit(
    options: ConsumeRequestRateLimitOptions
): RequestRateLimitResult {
    const { bucket, key, windowMs, maxRequests } = options;
    const store = getBucketStore(bucket);
    const now = Date.now();
    let entry = store.get(key);

    if (!entry || now >= entry.resetAt) {
        if (entry?.timeout) {
            clearTimeout(entry.timeout);
        }

        const timeout = setTimeout(() => {
            store.delete(key);
        }, windowMs);

        if (typeof timeout.unref === "function") {
            timeout.unref();
        }

        entry = {
            count: 0,
            resetAt: now + windowMs,
            timeout,
        };
        store.set(key, entry);
    }

    if (entry.count >= maxRequests) {
        return {
            allowed: false,
            limit: maxRequests,
            remaining: 0,
            retryAfterSeconds: Math.max(1, Math.ceil((entry.resetAt - now) / 1000)),
        };
    }

    entry.count += 1;

    return {
        allowed: true,
        limit: maxRequests,
        remaining: Math.max(0, maxRequests - entry.count),
        retryAfterSeconds: Math.max(0, Math.ceil((entry.resetAt - now) / 1000)),
    };
}

export async function consumeDistributedRequestRateLimit(
    options: ConsumeRequestRateLimitOptions
): Promise<RequestRateLimitResult> {
    if (!isRedisConfigured()) {
        return consumeRequestRateLimit(options);
    }

    const client = await getRedisClient();
    if (!client) {
        return consumeRequestRateLimit(options);
    }

    const { bucket, key, windowMs, maxRequests } = options;
    const counterKey = getRedisKey("rate-limit", bucket, key);
    let count: number;
    let ttlMs: number;
    try {
        const result = await client.eval(DISTRIBUTED_RATE_LIMIT_SCRIPT, {
            keys: [counterKey],
            arguments: [String(windowMs)],
        });
        if (
            !Array.isArray(result) ||
            result.length < 2 ||
            !Number.isFinite(Number(result[0])) ||
            !Number.isFinite(Number(result[1]))
        ) {
            throw new Error("Redis rate limit script returned invalid data");
        }
        count = Number(result[0]);
        ttlMs = Number(result[1]);
    } catch (error) {
        const now = Date.now();
        if (now - distributedFallbackWarningAt >= 30_000) {
            distributedFallbackWarningAt = now;
            console.warn(
                "Distributed rate limit failed; using process-local fallback. Repeated warnings are suppressed for 30 seconds.",
                error instanceof Error ? error.message : String(error)
            );
        }
        return consumeRequestRateLimit(options);
    }

    const retryAfterSeconds = Math.max(0, Math.ceil(Math.max(ttlMs, 0) / 1000));

    if (count > maxRequests) {
        return {
            allowed: false,
            limit: maxRequests,
            remaining: 0,
            retryAfterSeconds: Math.max(1, retryAfterSeconds),
        };
    }

    return {
        allowed: true,
        limit: maxRequests,
        remaining: Math.max(0, maxRequests - count),
        retryAfterSeconds,
    };
}

export function buildRateLimitHeaders(result: RequestRateLimitResult): Record<string, string> {
    return {
        "Retry-After": String(result.retryAfterSeconds),
        "X-RateLimit-Limit": String(result.limit),
        "X-RateLimit-Remaining": String(result.remaining),
    };
}

export function resetRequestRateLimitBuckets(): void {
    for (const store of rateLimitBuckets.values()) {
        for (const entry of store.values()) {
            clearTimeout(entry.timeout);
        }
        store.clear();
    }
    rateLimitBuckets.clear();
    distributedFallbackWarningAt = 0;
}
