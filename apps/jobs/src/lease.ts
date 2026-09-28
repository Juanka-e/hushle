import {
    getRedisClient,
    getRedisKey,
    isRedisConfigured,
} from "@hushle/platform-cache";
import { randomUUID } from "node:crypto";

const RELEASE_LEASE_SCRIPT = `
if redis.call("GET", KEYS[1]) == ARGV[1] then
  return redis.call("DEL", KEYS[1])
end
return 0
`;

export interface JobLease {
    release(): Promise<void>;
}

export async function acquireJobLease(
    jobName: string,
    ttlMs: number
): Promise<JobLease | null> {
    if (!isRedisConfigured()) {
        throw new Error("Redis is required for mutating jobs");
    }

    const client = await getRedisClient();
    if (!client) {
        throw new Error("Redis is unavailable; refusing an uncoordinated job run");
    }

    const key = getRedisKey("job-lease", jobName);
    const token = randomUUID();
    const acquired = await client.set(key, token, { PX: ttlMs, NX: true });
    if (acquired !== "OK") return null;

    return {
        async release() {
            await client.eval(RELEASE_LEASE_SCRIPT, {
                keys: [key],
                arguments: [token],
            });
        },
    };
}
