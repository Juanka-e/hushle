export const BRANDING_ASSET_TYPES = ["logo", "favicon", "og"] as const;
export type BrandingAssetType = (typeof BRANDING_ASSET_TYPES)[number];

const IMAGE_MIME_TO_EXTENSION: Record<string, string> = {
    "image/png": "png",
    "image/jpeg": "jpg",
    "image/webp": "webp",
};

export function isBrandingAssetType(value: string): value is BrandingAssetType {
    return (BRANDING_ASSET_TYPES as readonly string[]).includes(value);
}

export function getBrandingAssetUploadConfig(type: BrandingAssetType): {
    directory: string;
    maxSize: number;
    allowedMimeTypes: string[];
} {
    switch (type) {
        case "logo":
            return {
                directory: "logo",
                maxSize: 4 * 1024 * 1024,
                allowedMimeTypes: ["image/png", "image/jpeg", "image/webp"],
            };
        case "favicon":
            return {
                directory: "favicon",
                maxSize: 4 * 1024 * 1024,
                allowedMimeTypes: ["image/png", "image/jpeg", "image/webp"],
            };
        case "og":
            return {
                directory: "og",
                maxSize: 4 * 1024 * 1024,
                allowedMimeTypes: ["image/png", "image/jpeg", "image/webp"],
            };
    }
}

export function getBrandingAssetFileExtension(mimeType: string): string | null {
    return IMAGE_MIME_TO_EXTENSION[mimeType] ?? null;
}

export function hasValidBrandingAssetSignature(buffer: Buffer, mimeType: string): boolean {
    if (mimeType === "image/png") {
        return buffer.subarray(0, 8).equals(
            Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])
        );
    }

    if (mimeType === "image/jpeg") {
        return buffer[0] === 0xff && buffer[1] === 0xd8 && buffer[2] === 0xff;
    }

    if (mimeType === "image/webp") {
        return (
            buffer.subarray(0, 4).toString("ascii") === "RIFF" &&
            buffer.subarray(8, 12).toString("ascii") === "WEBP"
        );
    }

    return false;
}
