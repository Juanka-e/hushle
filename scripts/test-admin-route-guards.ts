import assert from "node:assert/strict";
import { readdirSync, readFileSync, statSync } from "node:fs";
import path from "node:path";

const adminApiRoot = path.join(
    process.cwd(),
    "apps",
    "web",
    "src",
    "app",
    "api",
    "admin"
);

function collectRouteFiles(directory: string): string[] {
    const entries = readdirSync(directory);
    const routeFiles: string[] = [];

    for (const entry of entries) {
        const fullPath = path.join(directory, entry);
        const stats = statSync(fullPath);

        if (stats.isDirectory()) {
            routeFiles.push(...collectRouteFiles(fullPath));
            continue;
        }

        if (entry === "route.ts") {
            routeFiles.push(fullPath);
        }
    }

    return routeFiles;
}

const routeFiles = collectRouteFiles(adminApiRoot);
assert.equal(routeFiles.length > 0, true, "Expected at least one admin API route.");

for (const routeFile of routeFiles) {
    const content = readFileSync(routeFile, "utf8");
    assert.equal(
        content.includes("requireAdminSession"),
        true,
        `Missing route-level admin guard: ${path.relative(process.cwd(), routeFile)}`
    );
}

console.log("admin route guard smoke test passed");
