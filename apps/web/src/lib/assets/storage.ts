import { constants, createReadStream } from "node:fs";
import { copyFile, link, lstat, mkdir, open, readdir, realpath, unlink } from "node:fs/promises";
import path from "node:path";
import { createHash, randomUUID } from "node:crypto";
import type { IncomingMessage, ServerResponse } from "node:http";
import { pipeline } from "node:stream/promises";

// Next may bundle import.meta.url into .next; resolve relative storage from the workspace instead.
const isWebWorkspace = path.basename(process.cwd()) === "web" && path.basename(path.dirname(process.cwd())) === "apps";
const mimeTypes: Record<string, string> = {
    ".png": "image/png", ".jpg": "image/jpeg", ".jpeg": "image/jpeg",
    ".webp": "image/webp", ".gif": "image/gif", ".ico": "image/x-icon",
};

export function getAssetStorageRoot(): string {
    return path.resolve(/*turbopackIgnore: true*/ process.cwd(), isWebWorkspace ? "../.." : ".", process.env.ASSET_STORAGE_PATH?.trim() || "data/assets");
}

export function resolveAssetPath(url: string, root = getAssetStorageRoot()): string | null {
    if (!/^\/(?:cosmetics|branding)\//.test(url) || /[%\\?#\x00-\x20]/.test(url)) return null;
    const segments = url.slice(1).split("/");
    if (segments.length < 3 || segments.some((entry) => !/^[A-Za-z0-9_-][A-Za-z0-9_.-]{0,150}$/.test(entry) || entry.includes(".."))) return null;
    if (!mimeTypes[path.extname(url).toLowerCase()]) return null;
    return path.join(root, ...segments);
}

async function assertContained(file: string, root: string): Promise<void> {
    const [actualRoot, actualFile] = await Promise.all([realpath(root), realpath(file)]);
    const relative = path.relative(actualRoot, actualFile);
    if (relative.startsWith("..") || path.isAbsolute(relative)) throw new Error("Asset path escapes storage");
}

export async function writeAsset(url: string, buffer: Buffer): Promise<void> {
    const root = getAssetStorageRoot();
    const file = resolveAssetPath(url, root);
    if (!file) throw new Error("Invalid asset path");
    await mkdir(path.dirname(file), { recursive: true });
    await assertContained(path.dirname(file), root);
    const temporary = `${file}.${randomUUID()}.partial`;
    try {
        const handle = await open(temporary, "wx", 0o600);
        try {
            await handle.writeFile(buffer);
            await handle.sync();
        } finally {
            await handle.close();
        }
        // Publish atomically without replacing an existing immutable URL.
        await link(temporary, file);
    } finally {
        await unlink(temporary).catch((error) => {
            if (error.code !== "ENOENT") throw error;
        });
    }
}

export async function migrateLegacyAssets(publicRoot: string): Promise<number> {
    const root = getAssetStorageRoot();
    await mkdir(root, { recursive: true });
    let copied = 0;
    async function walk(directory: string, prefix: string): Promise<void> {
        const entries = await readdir(directory, { withFileTypes: true }).catch((error) => {
            if (error.code === "ENOENT") return [];
            throw error;
        });
        for (const entry of entries) {
            if (entry.isSymbolicLink()) throw new Error("Legacy asset symlink is not allowed");
            const source = path.join(directory, entry.name);
            const url = `${prefix}/${entry.name}`;
            if (entry.isDirectory()) { await walk(source, url); continue; }
            const target = resolveAssetPath(url, root);
            if (!entry.isFile() || !target) continue;
            await mkdir(path.dirname(target), { recursive: true });
            await assertContained(path.dirname(target), root);
            try {
                await copyFile(source, target, constants.COPYFILE_EXCL);
                copied += 1;
            } catch (error) {
                if ((error as NodeJS.ErrnoException).code !== "EEXIST") throw error;
                // Existing storage always wins; never overwrite or delete a user's asset.
            }
        }
    }
    for (const namespace of ["cosmetics", "branding"]) await walk(path.join(publicRoot, namespace), `/${namespace}`);
    return copied;
}

export async function serveStoredAsset(req: IncomingMessage, res: ServerResponse): Promise<boolean> {
    const rawPath = (req.url ?? "").split("?")[0];
    if (!/^\/(?:cosmetics|branding)\//.test(rawPath)) return false;
    const root = getAssetStorageRoot();
    const file = resolveAssetPath(rawPath, root);
    if (!file) return false; // Bundled SVGs and other public assets remain Next-owned.
    if (req.method !== "GET" && req.method !== "HEAD") return false;
    try {
        await assertContained(file, root);
        const info = await lstat(file);
        if (!info.isFile() || info.isSymbolicLink()) throw new Error("Invalid asset file");
        const etag = `"${createHash("sha256").update(`${rawPath}:${info.size}:${info.mtimeMs}`).digest("hex")}"`;
        res.setHeader("Content-Type", mimeTypes[path.extname(file).toLowerCase()]);
        res.setHeader("X-Content-Type-Options", "nosniff");
        res.setHeader("ETag", etag);
        res.setHeader("Cache-Control", /\/[a-f0-9-]{36}\./i.test(rawPath) ? "public, max-age=31536000, immutable" : "public, max-age=300");
        if (req.headers["if-none-match"] === etag) { res.statusCode = 304; res.end(); return true; }
        res.setHeader("Content-Length", info.size);
        if (req.method === "HEAD") res.end();
        else await pipeline(createReadStream(file), res);
        return true;
    } catch (error) {
        if ((error as NodeJS.ErrnoException).code === "ENOENT") return false;
        if (!res.headersSent) { res.statusCode = 404; res.end(); }
        else res.destroy();
        return true;
    }
}
