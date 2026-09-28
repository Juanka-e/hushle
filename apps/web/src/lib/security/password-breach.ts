import { createHash } from "node:crypto";

export type PasswordBreachCheckResult =
    | { status: "clear"; occurrences: 0 }
    | { status: "breached"; occurrences: number }
    | { status: "unavailable"; occurrences: null };

let unavailableWarningAt = 0;

function warnUnavailable(): void {
    const now = Date.now();
    if (now - unavailableWarningAt < 60_000) return;
    unavailableWarningAt = now;
    console.warn(
        "Pwned Passwords check unavailable; local password policy remains enforced."
    );
}

export async function checkPasswordBreach(
    password: string,
    options: {
        fetchImpl?: typeof fetch;
        timeoutMs?: number;
    } = {}
): Promise<PasswordBreachCheckResult> {
    if (process.env.PASSWORD_BREACH_CHECK_ENABLED === "false") {
        return { status: "unavailable", occurrences: null };
    }

    const hash = createHash("sha1")
        .update(password, "utf8")
        .digest("hex")
        .toUpperCase();
    const prefix = hash.slice(0, 5);
    const suffix = hash.slice(5);

    try {
        const response = await (options.fetchImpl ?? fetch)(
            `https://api.pwnedpasswords.com/range/${prefix}`,
            {
                headers: {
                    "Add-Padding": "true",
                    "User-Agent": "Hushle-Password-Safety/1.0",
                },
                signal: AbortSignal.timeout(options.timeoutMs ?? 2_500),
            }
        );
        if (!response.ok) {
            warnUnavailable();
            return { status: "unavailable", occurrences: null };
        }

        const entries = (await response.text()).split(/\r?\n/);
        for (const entry of entries) {
            const [candidateSuffix, rawCount] = entry.split(":", 2);
            if (candidateSuffix !== suffix) continue;
            const occurrences = Number.parseInt(rawCount ?? "0", 10);
            if (Number.isFinite(occurrences) && occurrences > 0) {
                return { status: "breached", occurrences };
            }
            break;
        }
        return { status: "clear", occurrences: 0 };
    } catch {
        if (!options.fetchImpl) {
            warnUnavailable();
        }
        return { status: "unavailable", occurrences: null };
    }
}
