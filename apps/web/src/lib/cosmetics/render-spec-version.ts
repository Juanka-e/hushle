export const CURRENT_COSMETIC_RENDER_SPEC_VERSION = 1;
export const SUPPORTED_COSMETIC_RENDER_SPEC_VERSIONS = Object.freeze([
  1,
] as const);

export interface CosmeticRenderSpecResolution {
  requestedVersion: number;
  effectiveVersion: (typeof SUPPORTED_COSMETIC_RENDER_SPEC_VERSIONS)[number];
  usedFallback: boolean;
}

export function isSupportedCosmeticRenderSpecVersion(
  value: number,
): value is (typeof SUPPORTED_COSMETIC_RENDER_SPEC_VERSIONS)[number] {
  return SUPPORTED_COSMETIC_RENDER_SPEC_VERSIONS.includes(value as 1);
}

function normalizeRequestedVersion(value: unknown): number {
  return typeof value === "number" && Number.isSafeInteger(value) && value >= 1
    ? value
    : CURRENT_COSMETIC_RENDER_SPEC_VERSION;
}

export function resolveCosmeticRenderSpecVersion(
  value: unknown,
): CosmeticRenderSpecResolution {
  const requestedVersion = normalizeRequestedVersion(value);
  const supported = isSupportedCosmeticRenderSpecVersion(requestedVersion);

  return {
    requestedVersion,
    effectiveVersion: supported
      ? (requestedVersion as 1)
      : CURRENT_COSMETIC_RENDER_SPEC_VERSION,
    usedFallback: !supported,
  };
}
