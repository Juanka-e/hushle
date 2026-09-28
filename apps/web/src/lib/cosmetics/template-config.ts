import type { TemplateConfig, TemplateConfigArray, TemplateConfigObject, TemplateConfigScalar, TemplateConfigValue } from "@/types/economy";

const MAX_DEPTH = 3;
const MAX_KEYS_PER_OBJECT = 24;
const MAX_ARRAY_LENGTH = 12;

function isTemplateScalar(value: unknown): value is TemplateConfigScalar {
    return (
        value === null ||
        typeof value === "string" ||
        typeof value === "number" ||
        typeof value === "boolean"
    );
}

function isTemplateScalarArray(value: unknown): value is TemplateConfigArray {
    return Array.isArray(value) && value.length <= MAX_ARRAY_LENGTH && value.every(isTemplateScalar);
}

function normalizeTemplateNode(value: unknown, depth: number): TemplateConfigValue | undefined {
    if (isTemplateScalar(value)) {
        return value;
    }

    if (isTemplateScalarArray(value)) {
        return value;
    }

    if (!value || typeof value !== "object" || Array.isArray(value) || depth >= MAX_DEPTH) {
        return undefined;
    }

    const entries = Object.entries(value);
    if (entries.length === 0 || entries.length > MAX_KEYS_PER_OBJECT) {
        return undefined;
    }

    const normalizedEntries: [string, TemplateConfigValue][] = [];
    for (const [key, entryValue] of entries) {
        if (!key || key.length > 80) {
            continue;
        }

        const normalizedEntry = normalizeTemplateNode(entryValue, depth + 1);
        if (normalizedEntry !== undefined) {
            normalizedEntries.push([key, normalizedEntry]);
        }
    }

    return normalizedEntries.length > 0 ? Object.fromEntries(normalizedEntries) : undefined;
}

export function normalizeTemplateConfig(value: unknown): TemplateConfig | null {
    const normalized = normalizeTemplateNode(value, 0);

    if (!normalized || typeof normalized !== "object" || Array.isArray(normalized)) {
        return null;
    }

    return normalized as TemplateConfig;
}

export function isTemplateConfigObject(value: TemplateConfigValue | undefined): value is TemplateConfigObject {
    return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

export function getTemplateValue(
    config: TemplateConfig | null,
    path: readonly string[]
): TemplateConfigValue | undefined {
    let current: TemplateConfigValue | undefined = config ?? undefined;

    for (const segment of path) {
        if (!isTemplateConfigObject(current)) {
            return undefined;
        }
        current = current[segment];
    }

    return current;
}

export function getTemplateString(
    config: TemplateConfig | null,
    path: readonly string[]
): string | undefined {
    const value = getTemplateValue(config, path);
    return typeof value === "string" ? value : undefined;
}

export function getTemplateNumber(
    config: TemplateConfig | null,
    path: readonly string[]
): number | undefined {
    const value = getTemplateValue(config, path);
    return typeof value === "number" && Number.isFinite(value) ? value : undefined;
}

export function getTemplateBoolean(
    config: TemplateConfig | null,
    path: readonly string[]
): boolean | undefined {
    const value = getTemplateValue(config, path);
    return typeof value === "boolean" ? value : undefined;
}

export function getTemplateStringArray(
    config: TemplateConfig | null,
    path: readonly string[]
): string[] | undefined {
    const value = getTemplateValue(config, path);
    if (!Array.isArray(value)) {
        return undefined;
    }

    return value.every((entry) => typeof entry === "string")
        ? value
        : undefined;
}
