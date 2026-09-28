export interface PreflightResult {
    errors: string[];
    warnings: string[];
    checks: string[];
}

export function parseEnvFile(path: string): Record<string, string>;
export function validateProductionEnvironment(
    env: Record<string, string>
): PreflightResult;
