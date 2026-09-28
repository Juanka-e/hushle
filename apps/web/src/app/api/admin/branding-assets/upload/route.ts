import { mkdir, writeFile } from "fs/promises";
import path from "path";
import { randomUUID } from "crypto";
import { NextRequest, NextResponse } from "next/server";
import { requireAdminSession } from "@/lib/admin/require-admin";
import {
    getBrandingAssetFileExtension,
    getBrandingAssetUploadConfig,
    hasValidBrandingAssetSignature,
    isBrandingAssetType,
} from "@/lib/branding/upload";
import { writeAuditLog } from "@/lib/security/audit-log";
import {
    buildRateLimitHeaders,
    consumeDistributedRequestRateLimit,
    getRequestIp,
} from "@/lib/security/request-rate-limit";

export const dynamic = "force-dynamic";

export async function POST(request: NextRequest) {
    const adminSession = await requireAdminSession();
    if (adminSession instanceof NextResponse) {
        return adminSession;
    }

    const rateLimit = await consumeDistributedRequestRateLimit({
        bucket: "admin-branding-asset-upload",
        key: `${adminSession.id}:${getRequestIp(request)}`,
        windowMs: 5 * 60_000,
        maxRequests: 20,
    });

    if (!rateLimit.allowed) {
        return NextResponse.json(
            { error: "Cok fazla branding asset yuklemesi gonderildi. Lutfen bekleyin." },
            { status: 429, headers: buildRateLimitHeaders(rateLimit) }
        );
    }

    try {
        const formData = await request.formData();
        const file = formData.get("file");
        const assetTypeRaw = String(formData.get("assetType") || "");

        if (!(file instanceof File)) {
            return NextResponse.json(
                { error: "Dosya bulunamadi." },
                { status: 400, headers: buildRateLimitHeaders(rateLimit) }
            );
        }

        if (!isBrandingAssetType(assetTypeRaw)) {
            return NextResponse.json(
                { error: "Gecersiz branding asset tipi." },
                { status: 400, headers: buildRateLimitHeaders(rateLimit) }
            );
        }

        const config = getBrandingAssetUploadConfig(assetTypeRaw);
        if (!config.allowedMimeTypes.includes(file.type)) {
            return NextResponse.json(
                { error: "Gecersiz dosya turu. PNG, JPEG veya WebP olmali." },
                { status: 400, headers: buildRateLimitHeaders(rateLimit) }
            );
        }

        if (file.size > config.maxSize) {
            return NextResponse.json(
                { error: "Dosya boyutu bu asset tipi icin izin verilen siniri asiyor." },
                { status: 400, headers: buildRateLimitHeaders(rateLimit) }
            );
        }

        const extension = getBrandingAssetFileExtension(file.type);
        if (!extension) {
            return NextResponse.json(
                { error: "Dosya uzantisi cozulmedi." },
                { status: 400, headers: buildRateLimitHeaders(rateLimit) }
            );
        }

        const bytes = await file.arrayBuffer();
        const buffer = Buffer.from(bytes);
        if (!hasValidBrandingAssetSignature(buffer, file.type)) {
            return NextResponse.json(
                { error: "Dosya icerigi belirtilen image tipi ile eslesmiyor." },
                { status: 400, headers: buildRateLimitHeaders(rateLimit) }
            );
        }

        const fileName = `${randomUUID()}.${extension}`;
        const uploadDir = path.join(process.cwd(), "public", "branding", config.directory);
        await mkdir(uploadDir, { recursive: true });

        const filePath = path.join(uploadDir, fileName);
        await writeFile(filePath, buffer);

        await writeAuditLog({
            actor: adminSession,
            action: "admin.branding-asset.upload",
            resourceType: "branding_asset",
            resourceId: fileName,
            summary: `Uploaded branding asset ${fileName}`,
            metadata: {
                assetType: assetTypeRaw,
                mimeType: file.type,
                size: file.size,
            },
            request,
        });

        return NextResponse.json(
            {
                url: `/branding/${config.directory}/${fileName}`,
                fileName,
                assetType: assetTypeRaw,
            },
            { headers: buildRateLimitHeaders(rateLimit) }
        );
    } catch (error) {
        console.error("Failed to upload branding asset:", error);
        return NextResponse.json(
            { error: "Branding asset yuklenemedi." },
            { status: 500, headers: buildRateLimitHeaders(rateLimit) }
        );
    }
}
