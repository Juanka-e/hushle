import { writeAsset } from "@/lib/assets/storage";
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
            { error: "Çok fazla branding asset yüklemesi gönderildi. Lütfen bekleyin." },
            { status: 429, headers: buildRateLimitHeaders(rateLimit) }
        );
    }

    try {
        const formData = await request.formData();
        const file = formData.get("file");
        const assetTypeRaw = String(formData.get("assetType") || "");

        if (!(file instanceof File)) {
            return NextResponse.json(
                { error: "Dosya bulunamadı." },
                { status: 400, headers: buildRateLimitHeaders(rateLimit) }
            );
        }

        if (!isBrandingAssetType(assetTypeRaw)) {
            return NextResponse.json(
                { error: "Geçersiz branding asset tipi." },
                { status: 400, headers: buildRateLimitHeaders(rateLimit) }
            );
        }

        const config = getBrandingAssetUploadConfig(assetTypeRaw);
        if (!config.allowedMimeTypes.includes(file.type)) {
            return NextResponse.json(
                { error: "Geçersiz dosya türü. PNG, JPEG veya WebP olmalı." },
                { status: 400, headers: buildRateLimitHeaders(rateLimit) }
            );
        }

        if (file.size > config.maxSize) {
            return NextResponse.json(
                { error: "Dosya boyutu bu asset tipi için izin verilen sınırı aşıyor." },
                { status: 400, headers: buildRateLimitHeaders(rateLimit) }
            );
        }

        const extension = getBrandingAssetFileExtension(file.type);
        if (!extension) {
            return NextResponse.json(
                { error: "Dosya uzantısı çözülmedi." },
                { status: 400, headers: buildRateLimitHeaders(rateLimit) }
            );
        }

        const bytes = await file.arrayBuffer();
        const buffer = Buffer.from(bytes);
        if (!hasValidBrandingAssetSignature(buffer, file.type)) {
            return NextResponse.json(
                { error: "Dosya içeriği belirtilen image tipi ile eşleşmiyor." },
                { status: 400, headers: buildRateLimitHeaders(rateLimit) }
            );
        }

        const fileName = `${randomUUID()}.${extension}`;
        await writeAsset(`/branding/${config.directory}/${fileName}`, buffer);

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
            { error: "Branding asset yüklenemedi." },
            { status: 500, headers: buildRateLimitHeaders(rateLimit) }
        );
    }
}
