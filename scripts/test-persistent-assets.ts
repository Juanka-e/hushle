import assert from "node:assert/strict";
import { mkdtemp, mkdir, readFile, readdir, writeFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { createServer } from "node:http";
import { once } from "node:events";
import { randomUUID } from "node:crypto";
import { getAssetStorageRoot, resolveAssetPath, writeAsset, migrateLegacyAssets, serveStoredAsset } from "../apps/web/src/lib/assets/storage";

async function main() {
    const temporary = await mkdtemp(path.join(tmpdir(), "hushle-assets-test-"));
    const original = process.env.ASSET_STORAGE_PATH;
    process.env.ASSET_STORAGE_PATH = path.join(temporary, "persistent");
    const url = `/cosmetics/card_front/${randomUUID()}.png`;
    const bytes = Buffer.from("persistent-test-image");
    try {
        assert.equal(getAssetStorageRoot(), process.env.ASSET_STORAGE_PATH);
        for (const invalid of ["/cosmetics/../secret.png", "/cosmetics/card/../../secret.png", "/cosmetics/card/%2e%2e.png", "/branding/logo/x.svg", "/cosmetics/card/a\\b.png", "/other/x.png"]) assert.equal(resolveAssetPath(invalid), null);
        await writeAsset(url, bytes);
        await assert.rejects(writeAsset(url, Buffer.from("replacement")), /EEXIST/);
        assert.deepEqual(await readFile(resolveAssetPath(url)!), bytes);
        assert.equal((await readdir(path.dirname(resolveAssetPath(url)!))).filter((file) => file.endsWith(".partial")).length, 0);
        const legacy = path.join(temporary, "public");
        await mkdir(path.join(legacy, "branding", "logo"), { recursive: true });
        await writeFile(path.join(legacy, "branding", "logo", "old.png"), bytes);
        assert.equal(await migrateLegacyAssets(legacy), 1);
        assert.equal(await migrateLegacyAssets(legacy), 0);
        assert.deepEqual(await readFile(path.join(legacy, "branding", "logo", "old.png")), bytes);
        for (let iteration = 0; iteration < 2; iteration++) {
            const server = createServer(async (request, response) => {
                if (!await serveStoredAsset(request, response)) { response.statusCode = 404; response.end(); }
            });
            server.listen(0, "127.0.0.1");
            await once(server, "listening");
            try {
                const address = server.address();
                assert.ok(address && typeof address !== "string");
                const base = `http://127.0.0.1:${address.port}`;
                const response = await fetch(base + url);
                assert.equal(response.status, 200);
                assert.deepEqual(Buffer.from(await response.arrayBuffer()), bytes);
                assert.match(response.headers.get("cache-control")!, /immutable/);
                assert.equal(response.headers.get("x-content-type-options"), "nosniff");
                assert.equal((await fetch(base + url, { headers: { "if-none-match": response.headers.get("etag")! } })).status, 304);
                assert.equal((await fetch(base + url, { method: "HEAD" })).headers.get("content-length"), String(bytes.length));
                assert.equal((await fetch(base + "/cosmetics/card/missing.png")).status, 404);
            } finally { await new Promise<void>((resolve, reject) => server.close((error) => error ? reject(error) : resolve())); }
        }
        console.log("Persistent assets: immutable writes, traversal rejection, legacy migration and server recreation passed.");
    } finally {
        if (original === undefined) delete process.env.ASSET_STORAGE_PATH;
        else process.env.ASSET_STORAGE_PATH = original;
        await rm(temporary, { recursive: true, force: true });
    }
}
main().catch((error) => { console.error(error); process.exitCode = 1; });
