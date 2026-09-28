import assert from "node:assert/strict";

const baseUrl =
  process.env.SMOKE_BASE_URL ||
  process.env.NEXTAUTH_URL ||
  "http://127.0.0.1:3000";

async function expectStatus(path: string, expectedStatuses: number[]): Promise<void> {
  const response = await fetch(new URL(path, baseUrl), {
    redirect: "manual",
  });

  assert.ok(
    expectedStatuses.includes(response.status),
    `Expected ${path} to return one of [${expectedStatuses.join(", ")}], got ${response.status}`
  );

  console.log(`${path} -> ${response.status}`);
}

async function run(): Promise<void> {
  await expectStatus("/", [200]);
  await expectStatus("/login", [200]);
  await expectStatus("/dashboard", [307, 302]);
  await expectStatus("/room/ABC123", [200]);
  await expectStatus("/api/user/active-room", [401]);

  console.log(`gameplay-ui-http smoke test passed for ${baseUrl}`);
}

run().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
