import { zxcvbn, zxcvbnOptions } from "@zxcvbn-ts/core";
import * as common from "@zxcvbn-ts/language-common";

export const PASSWORD_MIN_LENGTH = 8;
export const PASSWORD_MAX_UTF8_BYTES = 72;
export const PASSWORD_MIN_SCORE = 3;

export type PasswordStrengthLevel =
    | "empty"
    | "very_weak"
    | "weak"
    | "acceptable"
    | "strong";

export interface PasswordPolicyContext {
    username?: string | null;
    email?: string | null;
    siteName?: string | null;
}

export interface PasswordPolicyResult {
    accepted: boolean;
    score: 0 | 1 | 2 | 3 | 4;
    level: PasswordStrengthLevel;
    utf8Bytes: number;
    issues: string[];
    suggestions: string[];
}

let configured = false;

function ensureConfigured(): void {
    if (configured) return;
    zxcvbnOptions.setOptions({
        dictionary: {
            ...common.dictionary,
            productTerms: ["hushle", "tabu", "tabuoyunu"],
        },
        graphs: common.adjacencyGraphs,
    });
    configured = true;
}

function getUtf8ByteLength(value: string): number {
    return new TextEncoder().encode(value).length;
}

function getUserInputs(context: PasswordPolicyContext): string[] {
    const emailLocalPart = context.email?.split("@", 1)[0] ?? "";
    return [
        context.username,
        emailLocalPart,
        context.siteName,
        "hushle",
        "tabu",
    ]
        .map((value) => value?.trim() ?? "")
        .filter((value) => value.length >= 3);
}

function toLevel(
    password: string,
    score: PasswordPolicyResult["score"],
    accepted: boolean
): PasswordStrengthLevel {
    if (!password) return "empty";
    if (accepted && score >= PASSWORD_MIN_SCORE) return "strong";
    if (score <= 1) return "very_weak";
    if (score === 2) return "weak";
    return "acceptable";
}

export function evaluatePasswordPolicy(
    password: string,
    context: PasswordPolicyContext = {}
): PasswordPolicyResult {
    ensureConfigured();

    const utf8Bytes = getUtf8ByteLength(password);
    const issues: string[] = [];
    if (password.length < PASSWORD_MIN_LENGTH) {
        issues.push(`Parola en az ${PASSWORD_MIN_LENGTH} karakter olmalıdır.`);
    }
    if (utf8Bytes > PASSWORD_MAX_UTF8_BYTES) {
        issues.push(
            `Parola UTF-8 olarak en fazla ${PASSWORD_MAX_UTF8_BYTES} byte olabilir.`
        );
    }

    const strength = zxcvbn(password, getUserInputs(context));
    const score = strength.score;
    if (password && score < PASSWORD_MIN_SCORE) {
        issues.push("Daha uzun ve tahmin edilmesi zor bir parola seçin.");
    }

    const accepted =
        password.length >= PASSWORD_MIN_LENGTH &&
        utf8Bytes <= PASSWORD_MAX_UTF8_BYTES &&
        score >= PASSWORD_MIN_SCORE;

    const suggestions = [
        ...strength.feedback.suggestions,
        strength.feedback.warning,
    ].filter((value): value is string => Boolean(value));

    return {
        accepted,
        score,
        level: toLevel(password, score, accepted),
        utf8Bytes,
        issues,
        suggestions,
    };
}
