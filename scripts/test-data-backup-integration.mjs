import assert from "node:assert/strict";
import { randomBytes } from "node:crypto";
import { createReadStream } from "node:fs";
import path from "node:path";
import { spawn } from "node:child_process";
import { createGunzip } from "node:zlib";
import { pipeline } from "node:stream/promises";
import { Transform } from "node:stream";
import { setTimeout as delay } from "node:timers/promises";
import { verifyBackup } from "./ops/data-backup.mjs";

const backup = process.argv[2];
if (!backup) throw new Error("Pass a verified backup directory. Only a disposable, isolated Docker MySQL is touched.");
await verifyBackup(backup);
const container = `hushle-backup-restore-test-${randomBytes(6).toString("hex")}`;
const environment = { ...process.env, MYSQL_ROOT_PASSWORD: randomBytes(24).toString("hex") };
async function docker(args, input) {
    const child = spawn("docker", args, { windowsHide: true, env: environment, stdio: [input ? "pipe" : "ignore", "pipe", "pipe"] });
    let output = "";
    let stderr = "";
    child.stdout.on("data", (data) => { output = (output + data.toString()).slice(-16000); });
    child.stderr.on("data", (data) => { stderr = (stderr + data.toString()).slice(-2000); });
    const completion = new Promise((resolve, reject) => {
        child.once("error", reject);
        child.once("close", (code) => code === 0 ? resolve(output.trim()) : reject(new Error(`Docker operation failed (${code}): ${stderr}`)));
    });
    const results = await Promise.allSettled([completion, input ? pipeline(input, child.stdin) : Promise.resolve()]);
    const failed = results.find((result) => result.status === "rejected");
    if (failed) throw failed.reason;
    return results[0].value;
}
let created = false;
try {
    await docker(["run", "--pull=never", "--detach", "--name", container, "--network", "none", "--tmpfs", "/var/lib/mysql:rw,size=512m",
        "-e", "MYSQL_ROOT_PASSWORD", "-e", "MYSQL_DATABASE=hushle_restore_check", "mysql:8.4"]);
    created = true;
    let ready = false;
    for (let attempt = 0; attempt < 90; attempt++) {
        try {
            await docker(["exec", container, "sh", "-lc", 'MYSQL_PWD="$MYSQL_ROOT_PASSWORD" mysql -uroot -N -e "SELECT 1"']);
            ready = true;
            break;
        } catch { await delay(1000); }
    }
    assert.ok(ready, "Isolated MySQL did not start");
    let carry = "";
    const tables = new Set();
    const inspect = new Transform({ transform(chunk, encoding, callback) {
        const lines = (carry + chunk.toString()).split("\n");
        carry = lines.pop();
        for (const line of lines) {
            const match = /^CREATE TABLE `([^`]+)`/.exec(line);
            if (match) tables.add(match[1]);
        }
        callback(null, chunk);
    } });
    const input = createReadStream(path.join(backup, "mysql.sql.gz")).pipe(createGunzip()).pipe(inspect);
    await docker(["exec", "-i", container, "sh", "-lc", 'MYSQL_PWD="$MYSQL_ROOT_PASSWORD" exec mysql -uroot hushle_restore_check'], input);
    const count = await docker(["exec", container, "sh", "-lc",
        'MYSQL_PWD="$MYSQL_ROOT_PASSWORD" mysql -uroot -N -e "SELECT COUNT(*) FROM information_schema.tables WHERE table_schema=\'hushle_restore_check\'; SELECT COUNT(*) FROM hushle_restore_check.users; SELECT COUNT(*) FROM hushle_restore_check.words;"']);
    const [tableCount, userCount, wordCount] = count.split(/\s+/).map(Number);
    assert.ok(tables.size > 0);
    assert.equal(tableCount, tables.size);
    assert.ok(Number.isSafeInteger(userCount) && Number.isSafeInteger(wordCount));
    console.log(`Isolated MySQL restore passed: ${tableCount} tables, ${userCount} users, ${wordCount} words. Live MySQL was not modified.`);
} finally {
    if (created) await docker(["rm", "--force", container]);
}
