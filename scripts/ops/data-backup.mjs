import { createHash, randomUUID } from "node:crypto";
import { createReadStream, createWriteStream, constants } from "node:fs";
import { copyFile, lstat, mkdir, open, readdir, realpath, rename, unlink, readFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { spawn } from "node:child_process";
import { pipeline } from "node:stream/promises";
import { Writable } from "node:stream";
import { createGzip, createGunzip } from "node:zlib";

const workspace = fileURLToPath(new URL("../../", import.meta.url));
const sha256 = async (file) => {
    const hash = createHash("sha256");
    for await (const chunk of createReadStream(file)) hash.update(chunk);
    return hash.digest("hex");
};
function safeFile(root, name) {
    if (!/^(?:assets\/[A-Za-z0-9_.\/-]+|mysql\.sql\.gz)$/.test(name) || name.split("/").some((part) => !part || part === "." || part === "..")) {
        throw new Error("Invalid backup entry");
    }
    return path.join(root, ...name.split("/"));
}
async function regularFile(root, file) {
    const relative = path.relative(await realpath(root), await realpath(file));
    if (relative.startsWith("..") || path.isAbsolute(relative) || !(await lstat(file)).isFile() || (await lstat(file)).isSymbolicLink()) {
        throw new Error("Backup path is not a contained regular file");
    }
}
async function validateGzip(file) {
    await pipeline(createReadStream(file), createGunzip(), new Writable({ write(_chunk, _encoding, done) { done(); } }));
}

export async function importLegacyAssets(sourceRoot, assets) {
    await mkdir(assets, { recursive: true });
    async function walk(directory, prefix) {
        const entries = await readdir(directory, { withFileTypes: true }).catch((error) => {
            if (error.code === "ENOENT") return [];
            throw error;
        });
        for (const entry of entries) {
            if (entry.isSymbolicLink()) throw new Error("Legacy asset symlink is not allowed");
            const source = path.join(directory, entry.name);
            const name = `${prefix}/${entry.name}`;
            if (entry.isDirectory()) { await walk(source, name); continue; }
            if (!entry.isFile() || !/\.(png|jpe?g|webp|gif|ico)$/i.test(entry.name)) continue;
            safeFile(assets, name);
            const target = path.join(assets, ...name.split("/").slice(1));
            await regularFile(sourceRoot, source);
            await mkdir(path.dirname(target), { recursive: true });
            const relative = path.relative(await realpath(assets), await realpath(path.dirname(target)));
            if (relative.startsWith("..") || path.isAbsolute(relative)) throw new Error("Legacy target escapes assets");
            await copyFile(source, target, constants.COPYFILE_EXCL).catch((error) => {
                if (error.code !== "EEXIST") throw error;
            });
        }
    }
    for (const name of ["cosmetics", "branding"]) await walk(path.join(sourceRoot, name), `assets/${name}`);
}

export async function dumpMysql(output, { compose, env }) {
    const child = spawn("docker", ["compose", "--env-file", env, "-f", compose, "exec", "-T", "mysql", "sh", "-lc",
        'MYSQL_PWD="$MYSQL_PASSWORD" exec mysqldump --single-transaction --quick --routines --triggers --no-tablespaces -u"$MYSQL_USER" "$MYSQL_DATABASE"'],
    { cwd: workspace, windowsHide: true, stdio: ["ignore", "pipe", "pipe"] });
    let stderr = "";
    child.stderr.on("data", (chunk) => { stderr = (stderr + chunk.toString()).slice(-2000); });
    const exited = new Promise((resolve, reject) => {
        child.once("error", reject);
        child.once("close", (code) => code === 0 ? resolve() : reject(new Error(`MySQL dump failed (${code}): ${stderr}`)));
    });
    const results = await Promise.allSettled([exited, pipeline(child.stdout, createGzip(), createWriteStream(output, { flags: "wx", mode: 0o600 }))]);
    const failure = results.find((result) => result.status === "rejected");
    if (failure) throw failure.reason;
    await validateGzip(output);
}

export async function createBackup({ assets, output, dump, dbFile }) {
    assets = path.resolve(assets);
    output = path.resolve(output);
    const isOutside = (relative) => relative === ".." || relative.startsWith(`..${path.sep}`) || path.isAbsolute(relative);
    if (!isOutside(path.relative(assets, output))) throw new Error("Backup output cannot be inside assets");
    await mkdir(output, { recursive: true, mode: 0o700 });
    if (!isOutside(path.relative(await realpath(assets), await realpath(output)))) throw new Error("Backup output cannot be inside assets");
    const lockPath = path.join(output, ".backup.lock");
    const lock = await open(lockPath, "wx", 0o600);
    const id = `hushle-data-${new Date().toISOString().replace(/[:.]/g, "-")}-${randomUUID().slice(0, 8)}`;
    const partial = path.join(output, `${id}.partial`);
    try {
        await lock.writeFile(JSON.stringify({ pid: process.pid, startedAt: new Date().toISOString() }));
        await mkdir(partial, { mode: 0o700 });
        const database = path.join(partial, "mysql.sql.gz");
        if (dbFile) {
            await regularFile(path.dirname(dbFile), dbFile);
            await copyFile(dbFile, database, constants.COPYFILE_EXCL);
            await validateGzip(database);
        } else {
            await dump(database);
        }
        // DB first, immutable assets second: every already-committed reference stays recoverable.
        const files = [];
        async function capture(directory, prefix) {
            for (const entry of await readdir(directory, { withFileTypes: true })) {
                if (entry.isSymbolicLink()) throw new Error("Asset symlinks are not allowed");
                const source = path.join(directory, entry.name);
                const name = `${prefix}/${entry.name}`;
                if (entry.isDirectory()) { await capture(source, name); continue; }
                if (!entry.isFile()) throw new Error("Special asset files are not allowed");
                if (entry.name.endsWith(".partial")) continue;
                await regularFile(assets, source);
                const destination = safeFile(partial, name);
                await mkdir(path.dirname(destination), { recursive: true, mode: 0o700 });
                await copyFile(source, destination, constants.COPYFILE_EXCL);
                files.push({ path: name, bytes: (await lstat(destination)).size, sha256: await sha256(destination) });
            }
        }
        await capture(assets, "assets");
        files.push({ path: "mysql.sql.gz", bytes: (await lstat(database)).size, sha256: await sha256(database) });
        files.sort((a, b) => a.path.localeCompare(b.path));
        const manifest = JSON.stringify({ format: "hushle-data-backup", version: 1, createdAt: new Date().toISOString(), files }, null, 2);
        const handle = await open(path.join(partial, "manifest.json"), "wx", 0o600);
        try { await handle.writeFile(manifest); await handle.sync(); } finally { await handle.close(); }
        await copyChecksum(partial, manifest);
        await verifyBackup(partial);
        const destination = path.join(output, id);
        await rename(partial, destination);
        return destination;
    } finally {
        await lock.close();
        await unlink(lockPath);
    }
}
async function copyChecksum(directory, manifest) {
    const handle = await open(path.join(directory, "manifest.sha256"), "wx", 0o600);
    try { await handle.writeFile(`${createHash("sha256").update(manifest).digest("hex")}  manifest.json\n`); } finally { await handle.close(); }
}

export async function verifyBackup(directory) {
    directory = path.resolve(directory);
    for (const name of ["manifest.json", "manifest.sha256"]) await regularFile(directory, path.join(directory, name));
    const manifestText = await readFile(path.join(directory, "manifest.json"), "utf8");
    const checksum = await readFile(path.join(directory, "manifest.sha256"), "utf8");
    if (checksum !== `${createHash("sha256").update(manifestText).digest("hex")}  manifest.json\n`) throw new Error("Manifest checksum mismatch");
    const manifest = JSON.parse(manifestText);
    if (manifest.format !== "hushle-data-backup" || manifest.version !== 1 || !Array.isArray(manifest.files) || !manifest.files.length) throw new Error("Unsupported backup manifest");
    const names = new Set();
    for (const entry of manifest.files) {
        if (names.has(entry.path) || !Number.isSafeInteger(entry.bytes) || entry.bytes < 0 || !/^[a-f0-9]{64}$/.test(entry.sha256)) throw new Error("Invalid backup metadata");
        names.add(entry.path);
        const file = safeFile(directory, entry.path);
        await regularFile(directory, file);
        if ((await lstat(file)).size !== entry.bytes || await sha256(file) !== entry.sha256) throw new Error(`Backup corruption: ${entry.path}`);
    }
    if (!names.has("mysql.sql.gz")) throw new Error("Database dump missing");
    await validateGzip(path.join(directory, "mysql.sql.gz"));
    return manifest;
}

export async function restoreAssets(directory, target) {
    const manifest = await verifyBackup(directory);
    target = path.resolve(target);
    // Even an existing empty directory is refused; this never writes over live storage.
    await mkdir(target, { recursive: false, mode: 0o700 });
    await mkdir(path.join(target, "assets"), { mode: 0o700 });
    for (const entry of manifest.files.filter((file) => file.path.startsWith("assets/"))) {
        const source = safeFile(directory, entry.path);
        await regularFile(directory, source);
        const destination = safeFile(target, entry.path);
        await mkdir(path.dirname(destination), { recursive: true, mode: 0o700 });
        await copyFile(source, destination, constants.COPYFILE_EXCL);
        if (await sha256(destination) !== entry.sha256) throw new Error("Restore verification failed");
    }
    return path.join(target, "assets");
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
    try {
        const [command, ...args] = process.argv.slice(2);
        const options = {};
        for (let index = 0; index < args.length; index += 2) {
            if (!/^--(?:assets|output|compose|env|db-file|backup|target|source)$/.test(args[index]) || !args[index + 1] || args[index + 1].startsWith("--")) throw new Error("Invalid option");
            options[args[index].slice(2)] = path.resolve(args[index + 1]);
        }
        if (command === "create") {
            const assets = options.assets ?? path.resolve(workspace, process.env.ASSET_STORAGE_PATH || "data/assets");
            await mkdir(assets, { recursive: true });
            await importLegacyAssets(path.join(workspace, "apps/web/public"), assets);
            console.log(await createBackup({ assets, output: options.output ?? path.join(workspace, "backups/data"), dbFile: options["db-file"],
                dump: (file) => dumpMysql(file, { compose: options.compose ?? path.join(workspace, "docker-compose.dev.yml"), env: options.env ?? path.join(workspace, ".env") }) }));
        } else if (command === "verify" && options.backup) {
            const result = await verifyBackup(options.backup);
            console.log(`Verified ${result.files.length} files; ${result.createdAt}`);
        } else if (command === "restore-assets" && options.backup && options.target) {
            console.log(await restoreAssets(options.backup, options.target));
        } else if (command === "import-legacy" && options.source && options.assets) {
            await importLegacyAssets(options.source, options.assets);
            console.log("Legacy assets copied without deletion or overwrite");
        } else throw new Error("Usage: create [--assets path --output path --compose file --env file --db-file dump.sql.gz] | verify --backup path | restore-assets --backup path --target NEW-directory");
    } catch (error) {
        console.error(error.message);
        process.exitCode = 1;
    }
}
