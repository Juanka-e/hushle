import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { resolveRealDeviceSmokeConfig } from "./start-real-device-smoke-server";

function read(path: string): string {
    return readFileSync(path, "utf8");
}

const packageJson = JSON.parse(read("package.json")) as {
    scripts?: Record<string, string>;
};
const server = read("scripts/start-real-device-smoke-server.ts");
const guide = read("docs/guides/web-real-device-smoke.md");
const evidence = read("docs/evidence/web-real-device-smoke-template.md");

assert.equal(
    packageJson.scripts?.["smoke:web-real-device-server"],
    "tsx scripts/start-real-device-smoke-server.ts"
);
assert.equal(
    packageJson.scripts?.["test:web-real-device-docs"],
    "tsx scripts/test-web-real-device-smoke.ts"
);
assert.equal(
    packageJson.scripts?.["test:web-real-device-server"],
    "tsx scripts/test-web-real-device-server-integration.ts"
);
assert.match(
    packageJson.scripts?.["test:web-launch-readiness"] ?? "",
    /npm run test:web-real-device-docs/
);
assert.match(
    packageJson.scripts?.["test:web-launch-readiness"] ?? "",
    /npm run test:web-real-device-server/
);

assert.match(server, /REAL_DEVICE_BASE_URL is required/);
assert.match(server, /baseUrl\.protocol !== "http:"/);
assert.match(server, /port < 1024 \|\| port > 65535/);
assert.match(server, /HOST:\s*"0\.0\.0\.0"/);
assert.match(server, /NEXTAUTH_URL:\s*config\.baseUrl/);
assert.match(server, /NEXT_PUBLIC_SITE_URL:\s*config\.baseUrl/);
assert.match(server, /AUTH_TRUST_HOST:\s*"true"/);
assert.match(server, /blockedHosts/);
assert.match(server, /isPrivateIpv4/);
assert.doesNotMatch(server, /REDIS_URL:\s*""/);
assert.doesNotMatch(server, /DATABASE_URL/);

assert.deepEqual(
    resolveRealDeviceSmokeConfig(" http://192.168.1.20:3202 "),
    {
        baseUrl: "http://192.168.1.20:3202",
        port: "3202",
    }
);
assert.throws(() => resolveRealDeviceSmokeConfig(), /is required/);
assert.throws(
    () => resolveRealDeviceSmokeConfig("http://127.0.0.1:3202"),
    /private LAN IPv4 origin/
);
assert.throws(
    () => resolveRealDeviceSmokeConfig("https://192.168.1.20:3202"),
    /must use http/
);
assert.throws(
    () => resolveRealDeviceSmokeConfig("http://192.168.1.20"),
    /must include an unprivileged port/
);
assert.throws(
    () => resolveRealDeviceSmokeConfig("http://192.168.1.20:3202/path"),
    /private LAN IPv4 origin/
);
assert.throws(
    () => resolveRealDeviceSmokeConfig("http://203.0.113.10:3202"),
    /private LAN IPv4 origin/
);

assert.match(guide, /aynı özel ağ/i);
assert.match(guide, /npm run build/);
assert.match(guide, /REAL_DEVICE_BASE_URL/);
assert.match(guide, /iOS Safari/);
assert.match(guide, /Android Chrome/);
assert.match(guide, /sanal klavye/i);
assert.match(guide, /WebSocket/i);
assert.match(guide, /fiziksel cihaz kanıtı değildir/i);
assert.match(guide, /docker compose down -v/);

assert.match(evidence, /Release SHA/);
assert.match(evidence, /Cihaz ve model/);
assert.match(evidence, /OS sürümü/);
assert.match(evidence, /Tarayıcı ve sürümü/);
assert.match(evidence, /GO \| HOLD/);
assert.match(evidence, /Yatay taşma/);
assert.match(evidence, /Sanal klavye/);
assert.match(evidence, /WebSocket/);

console.log("Real-device smoke documentation checks passed.");
