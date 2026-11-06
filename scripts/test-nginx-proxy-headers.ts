import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";

// nginx inherits `proxy_set_header` from the enclosing level only when the current level
// defines none of its own. A location that sets even one header (Upgrade, Connection) silently
// drops every server-level header: the app then sees `Host: hushle_app`, no X-Forwarded-*, and
// every per-IP limit counts nginx's own address. So the headers live at the server level and no
// location may declare any.

interface Block {
    header: string;
    directives: string[];
    children: Block[];
}

function parse(source: string): Block {
    const text = source.replace(/#[^\n]*/g, "");
    const root: Block = { header: "root", directives: [], children: [] };
    const stack: Block[] = [root];
    let buffer = "";
    for (const char of text) {
        if (char === "{") {
            const block: Block = { header: buffer.trim(), directives: [], children: [] };
            stack[stack.length - 1].children.push(block);
            stack.push(block);
            buffer = "";
        } else if (char === "}") {
            if (buffer.trim()) stack[stack.length - 1].directives.push(buffer.trim());
            stack.pop();
            assert.ok(stack.length > 0, "unbalanced braces in nginx.conf");
            buffer = "";
        } else if (char === ";") {
            stack[stack.length - 1].directives.push(buffer.trim().replace(/\s+/g, " "));
            buffer = "";
        } else {
            buffer += char;
        }
    }
    assert.equal(stack.length, 1, "unbalanced braces in nginx.conf");
    return root;
}

function headerNames(block: Block): string[] {
    return block.directives
        .filter((directive) => directive.startsWith("proxy_set_header "))
        .map((directive) => directive.split(" ")[1].toLowerCase());
}

function locations(block: Block): Block[] {
    return block.children.flatMap((child) => (child.header.startsWith("location") ? [child, ...locations(child)] : locations(child)));
}

export function proxyHeaderFailures(source: string): string[] {
    const failures: string[] = [];
    const servers = parse(source).children.filter((block) => block.header === "server");
    for (const server of servers) {
        for (const location of locations(server)) {
            const own = headerNames(location);
            if (own.length > 0) {
                failures.push(`${location.header} declares proxy_set_header (${own.join(", ")}), which drops the server-level headers`);
            }
        }
    }
    const proxying = servers.filter((server) => locations(server).some((location) => location.directives.some((d) => d.startsWith("proxy_pass "))));
    if (proxying.length === 0) failures.push("no server proxies to the app");
    for (const server of proxying) {
        const names = new Set(headerNames(server));
        for (const required of ["host", "x-forwarded-host", "x-forwarded-proto", "x-forwarded-for", "x-real-ip", "upgrade", "connection"]) {
            if (!names.has(required)) failures.push(`the proxying server does not set ${required}`);
        }
    }
    return failures;
}

function main(): void {
    const config = readFileSync(path.resolve(__dirname, "..", "nginx", "nginx.conf"), "utf8");
    const failures = proxyHeaderFailures(config);
    assert.deepEqual(failures, [], `nginx.conf proxy headers:\n- ${failures.join("\n- ")}`);

    // The rule itself: the shape that broke production-to-be is refused, the fixed shape passes.
    const broken = [
        "server { listen 443; proxy_set_header Host $host; proxy_set_header X-Forwarded-Host $host;",
        "proxy_set_header X-Forwarded-Proto https; proxy_set_header X-Forwarded-For $remote_addr;",
        "proxy_set_header X-Real-IP $remote_addr;",
        "location / { proxy_set_header Upgrade $http_upgrade; proxy_set_header Connection $connection_upgrade; proxy_pass http://app; } }",
    ].join("\n");
    assert.equal(proxyHeaderFailures(broken).length, 3, "a location with its own headers is refused and the server lacks Upgrade/Connection");
    const fixed = [
        "server { listen 443; proxy_set_header Host $host; proxy_set_header X-Forwarded-Host $host;",
        "proxy_set_header X-Forwarded-Proto https; proxy_set_header X-Forwarded-For $remote_addr;",
        "proxy_set_header X-Real-IP $remote_addr; proxy_set_header Upgrade $http_upgrade; # comment ; {",
        "proxy_set_header Connection $connection_upgrade;",
        "location / { proxy_http_version 1.1; proxy_pass http://app; }",
        "location ^~ /stream/ { proxy_pass http://app; } }",
    ].join("\n");
    assert.deepEqual(proxyHeaderFailures(fixed), []);
    const missing = "server { proxy_set_header Host $host; location / { proxy_pass http://app; } }";
    assert.ok(proxyHeaderFailures(missing).some((failure) => failure.includes("x-forwarded-for")));

    console.log("nginx proxy header checks passed");
}

main();
