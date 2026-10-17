import assert from "node:assert/strict";
import { mkdtemp, mkdir, readFile, writeFile, rm, readdir } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { gzipSync } from "node:zlib";
import { createBackup, verifyBackup, restoreAssets, importLegacyAssets } from "./ops/data-backup.mjs";

const root = await mkdtemp(path.join(tmpdir(), "hushle-backup-test-"));
try {
    const assets = path.join(root, "assets");
    await mkdir(path.join(assets, "cosmetics", "card_front"), { recursive: true });
    await writeFile(path.join(assets, "cosmetics", "card_front", "one.png"), "original");
    const legacy = path.join(root, "public");
    await mkdir(path.join(legacy, "cosmetics", "card_front"), { recursive: true });
    await writeFile(path.join(legacy, "cosmetics", "card_front", "one.png"), "do-not-overwrite");
    await writeFile(path.join(legacy, "cosmetics", "card_front", "two.png"), "legacy-original");
    await importLegacyAssets(legacy, assets);
    assert.equal(await readFile(path.join(assets, "cosmetics", "card_front", "one.png"), "utf8"), "original");
    assert.equal(await readFile(path.join(assets, "cosmetics", "card_front", "two.png"), "utf8"), "legacy-original");
    assert.ok(!(await readdir(assets)).includes("assets"));
    const dump = async (file) => writeFile(file, gzipSync("CREATE TABLE example (id INT);\n"), { flag: "wx" });
    const options = { assets, output: path.join(root, "backups"), dump };
    const backup = await createBackup(options);
    assert.equal((await verifyBackup(backup)).files.length, 3);
    const target = path.join(root, "restore");
    const restored = await restoreAssets(backup, target);
    assert.equal(await readFile(path.join(restored, "cosmetics", "card_front", "one.png"), "utf8"), "original");
    await assert.rejects(restoreAssets(backup, target), /EEXIST/);
    await assert.rejects(createBackup({ ...options, output: path.join(assets, "nested") }), /inside assets/);
    await assert.rejects(createBackup({ ...options, output: path.join(assets, "..nested") }), /inside assets/);
    await writeFile(path.join(options.output, ".backup.lock"), "existing-owner");
    await assert.rejects(createBackup(options), /EEXIST/);
    await rm(path.join(options.output, ".backup.lock"));
    await writeFile(path.join(backup, "assets", "cosmetics", "card_front", "one.png"), "tampered");
    await assert.rejects(verifyBackup(backup), /corruption/);
    await assert.rejects(restoreAssets(backup, path.join(root, "corrupt-restore")), /corruption/);
    assert.ok(!(await readdir(root)).includes("corrupt-restore"));
    const failed = { ...options, dump: async () => { throw new Error("dump unavailable"); } };
    await assert.rejects(createBackup(failed), /dump unavailable/);
    assert.ok(!(await readdir(options.output)).includes(".backup.lock"));
    console.log("Data backup: checksums, gzip, restore, corruption, locking and live-target protection passed.");
} finally {
    await rm(root, { recursive: true, force: true });
}
