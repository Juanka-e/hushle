import { resolve } from "node:path";
import { parseEnvFile, validateProductionEnvironment } from "./lib/production-preflight.mjs";

const envIndex = process.argv.indexOf("--env-file");
const positionalPath = process.argv[2]?.startsWith("-") ? undefined : process.argv[2];
const envPath = resolve(
    envIndex >= 0 && process.argv[envIndex + 1]
        ? process.argv[envIndex + 1]
        : positionalPath ?? ".env.production"
);

try {
    const result = validateProductionEnvironment(parseEnvFile(envPath));
    for (const warning of result.warnings) console.warn(`WARNING: ${warning}`);
    for (const error of result.errors) console.error(`BLOCKER: ${error}`);
    if (result.errors.length > 0) {
        console.error(`Production preflight failed with ${result.errors.length} blocker(s). Secret values were not printed.`);
        process.exitCode = 1;
    } else {
        console.log(`Production preflight passed (${result.checks.length} checks, ${result.warnings.length} warnings). Secret values were not printed.`);
    }
} catch (error) {
    console.error(`Production preflight could not read the environment file: ${error instanceof Error ? error.message : "unknown error"}`);
    process.exitCode = 1;
}
