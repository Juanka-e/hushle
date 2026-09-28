Object.assign(process.env, {
  NODE_ENV: "production",
  PORT: "3201",
  HOST: "127.0.0.1",
  NEXTAUTH_URL: "http://127.0.0.1:3201",
  NEXT_PUBLIC_SITE_URL: "http://127.0.0.1:3201",
  AUTH_TRUST_HOST: "true",
  REDIS_URL: process.env.PLAYWRIGHT_REDIS_URL ?? "",
  SOCKET_IO_REDIS_ADAPTER_ENABLED: "false",
  ROOM_OWNERSHIP_LEASE_ENABLED: "false",
});

import("../apps/web/server").catch((error) => {
  console.error(error);
  process.exit(1);
});
