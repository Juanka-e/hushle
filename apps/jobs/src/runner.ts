import { closeRedisClient, writeOperationalHeartbeat } from "@hushle/platform-cache";
import { prisma } from "@hushle/platform-db";
import {
    configureObservabilityFromEnvironment,
    emitObservabilityEvent,
    flushObservabilityExporter,
    reportError,
} from "@hushle/platform-observability";
import { areJobsEnabled } from "./config";
import { acquireJobLease } from "./lease";
import { reportPaymentOperationalThresholds } from "./payment-operations";
import {
    getJobDefinition,
    isJobName,
    type JobName,
} from "./registry";

interface RunnerArguments {
    job: JobName;
    execute: boolean;
}

configureObservabilityFromEnvironment();

function parseArguments(args: string[]): RunnerArguments {
    let job: RunnerArguments["job"] | null = null;
    let execute = false;

    for (let index = 0; index < args.length; index += 1) {
        const argument = args[index];
        if (argument === "--job") {
            const value = args[index + 1];
            if (!value || !isJobName(value)) {
                throw new Error("Unknown or missing --job value");
            }
            job = value;
            index += 1;
        } else if (isJobName(argument)) {
            job = argument;
        } else if (argument === "--execute" || argument === "execute") {
            execute = true;
        } else if (argument !== "--dry-run" && argument !== "dry-run") {
            throw new Error(`Unknown argument: ${argument}`);
        }
    }

    if (!job) {
        throw new Error("A job name is required");
    }
    return { job, execute };
}

async function main(): Promise<void> {
    const args = parseArguments(process.argv.slice(2));
    const dryRun = !args.execute;
    const definition = getJobDefinition(args.job);

    if (!dryRun && !areJobsEnabled()) {
        throw new Error(
            "Mutating jobs require JOBS_ENABLED=true and execute mode"
        );
    }

    const lease = dryRun
        ? null
        : await acquireJobLease(args.job, definition.leaseTtlMs);
    if (!dryRun && !lease) {
        console.log(JSON.stringify({ job: args.job, skipped: "lease-held" }));
        return;
    }

    try {
        const startedAt = Date.now();
        const result = await definition.run({ dryRun });
        const durationMs = Date.now() - startedAt;
        if (!dryRun) {
            await reportPaymentOperationalThresholds(args.job);
            await writeOperationalHeartbeat({
                name: args.job,
                completedAt: new Date(),
                durationMs,
            });
            await emitObservabilityEvent({
                level: "info",
                service: "hushle-jobs",
                event: "job.run.completed",
                context: { job: args.job, durationMs },
            });
        }
        console.log(JSON.stringify({ job: args.job, ...result }));
    } finally {
        await lease?.release();
    }
}

main()
    .catch(async (error) => {
        await reportError({
            service: "hushle-jobs",
            event: "job.run.failed",
            error,
            context: { job: process.argv.slice(2, 4) },
        });
        process.exitCode = 1;
    })
    .finally(async () => {
        await Promise.allSettled([
            flushObservabilityExporter(),
            prisma.$disconnect(),
            closeRedisClient(),
        ]);
    });
