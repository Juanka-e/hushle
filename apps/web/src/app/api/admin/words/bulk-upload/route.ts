import { NextRequest, NextResponse } from "next/server";
import { requireAdminSession } from "@/lib/admin/require-admin";
import {
    buildRateLimitHeaders,
    consumeDistributedRequestRateLimit,
    getRequestIp,
} from "@/lib/security/request-rate-limit";
import { writeAuditLog } from "@/lib/security/audit-log";
import {
    processBulkWordUpload,
    MAX_BULK_WORD_UPLOAD_FILE_BYTES,
    type BulkUploadMode,
} from "@/lib/admin-words-bulk-upload/service";
import { invalidateAdminDashboardStatsCache } from "@/lib/cache/application-cache";
import {
    DEFAULT_GAME_CONTENT_LOCALE,
    isGameContentLocale,
} from "@hushle/domain-game";

export const dynamic = "force-dynamic";

export async function POST(request: NextRequest) {
    const adminSession = await requireAdminSession();
    if (adminSession instanceof NextResponse) {
        return adminSession;
    }

    const rateLimit = await consumeDistributedRequestRateLimit({
        bucket: "admin-words-bulk-upload",
        key: `admin:${adminSession.id}:${getRequestIp(request)}`,
        windowMs: 60_000,
        maxRequests: 10,
    });
    if (!rateLimit.allowed) {
        return NextResponse.json(
            { error: "Cok fazla toplu kelime yukleme denemesi. Lutfen biraz bekleyin." },
            { status: 429, headers: buildRateLimitHeaders(rateLimit) }
        );
    }

    try {
        const formData = await request.formData();
        const file = formData.get("file");
        const mode = String(formData.get("mode") || "fixed_categories").trim() as BulkUploadMode;
        const categoryIdValue = String(formData.get("categoryId") || "").trim();
        const subcategoryIdValue = String(formData.get("subcategoryId") || "").trim();
        const localeValue = String(
            formData.get("locale") || DEFAULT_GAME_CONTENT_LOCALE
        ).trim();
        if (!isGameContentLocale(localeValue)) {
            return NextResponse.json(
                { error: "Gecersiz kelime paketi dili." },
                { status: 422, headers: buildRateLimitHeaders(rateLimit) }
            );
        }
        const locale = localeValue;

        if (!(file instanceof File)) {
            return NextResponse.json(
                { error: "Dosya bulunamadi." },
                { status: 400, headers: buildRateLimitHeaders(rateLimit) }
            );
        }

        if (file.size > MAX_BULK_WORD_UPLOAD_FILE_BYTES) {
            return NextResponse.json(
                { error: "CSV dosyasi en fazla 2 MB olabilir." },
                { status: 413, headers: buildRateLimitHeaders(rateLimit) }
            );
        }

        if (mode !== "fixed_categories" && mode !== "csv_categories") {
            return NextResponse.json(
                { error: "Gecersiz import modu." },
                { status: 422, headers: buildRateLimitHeaders(rateLimit) }
            );
        }

        const text = await file.text();
        const processed = await processBulkWordUpload({
            text,
            mode,
            categoryIdValue,
            subcategoryIdValue,
            locale,
        });
        if ("error" in processed) {
            return NextResponse.json(
                { error: processed.error },
                { status: processed.error === "CSV dosyasi bos." ? 400 : 422, headers: buildRateLimitHeaders(rateLimit) }
            );
        }
        const { results, fixedCategoryIds } = processed;

        await writeAuditLog({
            actor: adminSession,
            action: "admin.word.bulk_upload",
            resourceType: "word",
            summary: `Bulk uploaded words from ${file.name}`,
            metadata: {
                fileName: file.name,
                mode,
                successCount: results.success,
                skippedCount: results.skipped,
                errorCount: results.errors.length,
                fixedCategoryIds,
                locale,
            },
            request,
        });
        if (results.success > 0) {
            await invalidateAdminDashboardStatsCache();
        }

        return NextResponse.json(results, { headers: buildRateLimitHeaders(rateLimit) });
    } catch (error) {
        console.error("Bulk upload failed:", error);
        return NextResponse.json(
            { error: "Toplu yukleme basarisiz." },
            { status: 500, headers: buildRateLimitHeaders(rateLimit) }
        );
    }
}
