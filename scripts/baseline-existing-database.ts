import { spawnSync } from "node:child_process";
import { join } from "node:path";

const BASELINE_MIGRATION = "20260731000000_baseline";
const REQUIRED_CONFIRMATION = "I_HAVE_A_VERIFIED_BACKUP";
const prismaCli = join(
  process.cwd(),
  "node_modules",
  "prisma",
  "build",
  "index.js",
);

function runPrisma(args: string[], acceptedExitCodes = [0]): number {
  const result = spawnSync(process.execPath, [prismaCli, ...args], {
    env: process.env,
    stdio: "inherit",
  });

  if (result.error) {
    throw result.error;
  }

  const status = result.status ?? 1;
  if (!acceptedExitCodes.includes(status)) {
    process.exit(status);
  }

  return status;
}

if (process.env.PRISMA_BASELINE_CONFIRM !== REQUIRED_CONFIRMATION) {
  console.error(
    `Refusing to baseline. Set PRISMA_BASELINE_CONFIRM=${REQUIRED_CONFIRMATION} only after a verified backup.`,
  );
  process.exit(1);
}

console.log("Checking the existing database against prisma/schema.prisma...");
const driftStatus = runPrisma(
  [
    "migrate",
    "diff",
    "--from-schema-datasource",
    "prisma/schema.prisma",
    "--to-schema-datamodel",
    "prisma/schema.prisma",
    "--exit-code",
  ],
  [0, 2],
);

if (driftStatus === 2) {
  console.error(
    "Refusing to baseline because the existing database differs from prisma/schema.prisma. Reconcile the drift without resetting data, then retry.",
  );
  process.exit(2);
}

console.log(
  `Recording ${BASELINE_MIGRATION} as applied; baseline SQL will not be executed.`,
);
runPrisma([
  "migrate",
  "resolve",
  "--applied",
  BASELINE_MIGRATION,
  "--schema",
  "prisma/schema.prisma",
]);
runPrisma(["migrate", "status", "--schema", "prisma/schema.prisma"]);

console.log("Existing database baseline completed.");
