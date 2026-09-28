import type { NextConfig } from "next";
import { loadEnvConfig } from "@next/env";
import { fileURLToPath } from "node:url";

const workspaceRoot = fileURLToPath(new URL("../..", import.meta.url));
loadEnvConfig(workspaceRoot, process.env.NODE_ENV !== "production");

const nextConfig: NextConfig = {
  transpilePackages: [
    "@hushle/domain-game",
    "@hushle/platform-cache",
    "@hushle/platform-db",
    "@hushle/platform-inventory",
    "@hushle/platform-observability",
    "@hushle/platform-player",
    "@hushle/platform-store",
  ],
  experimental: {
    optimizePackageImports: ["lucide-react"],
  },
  async headers() {
    return [
      {
        source: "/:path*",
        headers: [
          { key: "X-Frame-Options", value: "DENY" },
          { key: "X-Content-Type-Options", value: "nosniff" },
          { key: "Referrer-Policy", value: "strict-origin-when-cross-origin" },
          { key: "Permissions-Policy", value: "camera=(), microphone=(), geolocation=()" },
        ],
      },
    ];
  },
};

export default nextConfig;
