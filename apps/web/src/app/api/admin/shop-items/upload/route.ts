import { mkdir, writeFile } from "fs/promises";
import path from "path";
import { randomUUID } from "crypto";
import { NextRequest, NextResponse } from "next/server";
import { requireAdminSession } from "@/lib/admin/require-admin";
import { writeAuditLog } from "@/lib/security/audit-log";
import {
    buildRateLimitHeaders,
    consumeRequestRateLimit,
    getRequestIp,
} from "@/lib/security/request-rate-limit";

export const dynamic = "force-dynamic";

const MIME_TO_EXTENSION: Record<string, string> = {
    "image/png": "png",
    "image/jpeg": "jpg",
    "image/webp": "webp",
    "image/gif": "gif",
};

const MAX_SIZE = 2 * 1024 * 1024; // 2 MB

function hasValidSignature(buffer: Buffer, mimeType: string): boolean {
    if (mimeType === "image/png") {
        return buffer.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]));
    }

    if (mimeType === "image/jpeg") {
        return buffer[0] === 0xff && buffer[1] === 0xd8 && buffer[2] === 0xff;
    }

    if (mimeType === "image/gif") {
        return buffer.subarray(0, 4).toString("ascii") === "GIF8";
    }

    if (mimeType === "image/webp") {
        return buffer.subarray(0, 4).toString("ascii") === "RIFF"
            && buffer.subarray(8, 12).toString("ascii") === "WEBP";
    }

    return false;
}

export async function POST(request: NextRequest) {
    const adminSession = await requireAdminSession();
    if (adminSession instanceof NextResponse) {
        return adminSession;
    }

    const rateLimit = consumeRequestRateLimit({
        bucket: "admin-shop-item-upload",
        key: `admin:${adminSession.id}:${getRequestIp(request)}`,
        windowMs: 60_000,
        maxRequests: 20,
    });
    if (!rateLimit.allowed) {
        return NextResponse.json(
            { error: "Cok fazla kozmetik dosyasi yukleme denemesi. Lutfen biraz bekleyin." },
            { status: 429, headers: buildRateLimitHeaders(rateLimit) }
        );
    }

    try {
        const formData = await request.formData();
        const file = formData.get("file");
        const category = String(formData.get("category") || "general");

        if (!(file instanceof File)) {
            return NextResponse.json({ error: "Dosya bulunamadi." }, { status: 400 });
        }

        const extension = MIME_TO_EXTENSION[file.type];
        if (!extension) {
            return NextResponse.json(
                { error: "Gecersiz dosya turu. PNG, JPEG, WebP veya GIF olmali." },
                { status: 400 }
            );
        }

        if (file.size > MAX_SIZE) {
            return NextResponse.json(
                { error: "Dosya boyutu 2MB'i asamaz." },
                { status: 400 }
            );
        }

        const bytes = await file.arrayBuffer();
        const buffer = Buffer.from(bytes);
        if (!hasValidSignature(buffer, file.type)) {
            return NextResponse.json(
                { error: "Dosya icerigi belirtilen image tipi ile eslesmiyor." },
                { status: 400 }
            );
        }

        const normalizedCategory = category.replace(/[^a-z0-9-_]/gi, "").slice(0, 40) || "general";
        const fileName = `${randomUUID()}.${extension}`;
        const uploadDir = path.join(process.cwd(), "public", "cosmetics", normalizedCategory);

        await mkdir(uploadDir, { recursive: true });

        const filePath = path.join(uploadDir, fileName);
        await writeFile(filePath, buffer);
        await writeAuditLog({
            actor: adminSession,
            action: "admin.shop-item.upload",
            resourceType: "asset",
            resourceId: fileName,
            summary: `Uploaded cosmetic asset ${fileName}`,
            metadata: {
                category: normalizedCategory,
                mimeType: file.type,
                size: file.size,
            },
            request,
        });

        return NextResponse.json(
            {
                url: `/cosmetics/${normalizedCategory}/${fileName}`,
                fileName,
            },
            { headers: buildRateLimitHeaders(rateLimit) }
        );
    } catch (error) {
        console.error("Failed to upload file:", error);
        return NextResponse.json(
            { error: "Dosya yuklenemedi." },
            { status: 500 }
        );
    }
}
