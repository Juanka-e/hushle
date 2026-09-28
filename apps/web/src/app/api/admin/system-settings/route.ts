import { NextRequest, NextResponse } from "next/server";
import { requireAdminSession } from "@/lib/admin/require-admin";
import {
    systemSettingsWriteSchema,
    SYSTEM_SETTINGS_NAMESPACES,
} from "@/lib/system-settings/schema";
import {
    getCaptchaProviderReadiness,
    getOutboundEmailReadiness,
    getSystemSettings,
    updateSystemSettings,
} from "@/lib/system-settings/service";
import { writeAuditLog } from "@/lib/security/audit-log";
import {
    buildRateLimitHeaders,
    consumeRequestRateLimit,
    getRequestIp,
} from "@/lib/security/request-rate-limit";

export const dynamic = "force-dynamic";

export async function GET() {
    const adminSession = await requireAdminSession();
    if (adminSession instanceof NextResponse) {
        return adminSession;
    }

    const settings = await getSystemSettings();
    return NextResponse.json({
        settings,
        captchaReadiness: getCaptchaProviderReadiness(),
        emailReadiness: getOutboundEmailReadiness(),
        namespaces: [...SYSTEM_SETTINGS_NAMESPACES],
    });
}

export async function PUT(req: NextRequest) {
    const adminSession = await requireAdminSession();
    if (adminSession instanceof NextResponse) {
        return adminSession;
    }

    const rateLimit = consumeRequestRateLimit({
        bucket: "admin-system-settings-write",
        key: `${adminSession.id}:${getRequestIp(req)}`,
        windowMs: 5 * 60_000,
        maxRequests: 20,
    });

    if (!rateLimit.allowed) {
        return NextResponse.json(
            { error: "Cok fazla sistem ayari guncellemesi gonderildi. Lutfen bekleyin." },
            {
                status: 429,
                headers: buildRateLimitHeaders(rateLimit),
            }
        );
    }

    try {
        const body = await req.json();
        const nextSettings = systemSettingsWriteSchema.parse(body);
        const emailReadiness = getOutboundEmailReadiness();
        if (
            nextSettings.security.emailVerification.mode ===
                "required_for_new_accounts" &&
            !emailReadiness.configured
        ) {
            return NextResponse.json(
                {
                    error:
                        "Zorunlu e-posta doğrulaması açılmadan önce SMTP, public site URL ve email token secret eksiksiz olmalıdır.",
                    emailReadiness,
                },
                {
                    status: 422,
                    headers: buildRateLimitHeaders(rateLimit),
                }
            );
        }
        const updatedSettings = await updateSystemSettings(nextSettings, adminSession.id);

        await writeAuditLog({
            actor: adminSession,
            action: "admin.system-settings.update",
            resourceType: "system_settings",
            resourceId: "global",
            summary: "Updated platform system settings",
            metadata: {
                namespaces: [...SYSTEM_SETTINGS_NAMESPACES],
                maintenanceEnabled: updatedSettings.platform.maintenanceEnabled,
                siteName: updatedSettings.branding.siteName,
                logoUrl: updatedSettings.branding.logoUrl,
                faviconUrl: updatedSettings.branding.faviconUrl,
                ogImageUrlConfigured: updatedSettings.branding.ogImageUrl.length > 0,
                storeEnabled: updatedSettings.features.storeEnabled,
                registrationsEnabled: updatedSettings.features.registrationsEnabled,
                bundlesEnabled: updatedSettings.economy.bundlesEnabled,
                couponsEnabled: updatedSettings.economy.couponsEnabled,
                discountCampaignsEnabled: updatedSettings.economy.discountCampaignsEnabled,
                storePriceMultiplier: updatedSettings.economy.storePriceMultiplier,
                matchCoinMultiplier: updatedSettings.economy.matchCoinMultiplier,
                matchRewardGuardEnabled: updatedSettings.economy.matchRewardGuardEnabled,
                matchRewardWindowHours: updatedSettings.economy.matchRewardWindowHours,
                matchRewardSoftCapCoin: updatedSettings.economy.matchRewardSoftCapCoin,
                matchRewardHardCapCoin: updatedSettings.economy.matchRewardHardCapCoin,
                matchRewardMinMultiplier: updatedSettings.economy.matchRewardMinMultiplier,
                matchRewardDampingProfile: updatedSettings.economy.matchRewardDampingProfile,
                repeatedGroupEnabled: updatedSettings.economy.repeatedGroupEnabled,
                repeatedGroupWindowHours: updatedSettings.economy.repeatedGroupWindowHours,
                repeatedGroupThreshold: updatedSettings.economy.repeatedGroupThreshold,
                repeatedGroupMinMultiplier: updatedSettings.economy.repeatedGroupMinMultiplier,
                roomMaxPlayers: updatedSettings.capacity.roomMaxPlayers,
                teamMaxPlayers: updatedSettings.capacity.teamMaxPlayers,
                maxActiveRooms: updatedSettings.capacity.maxActiveRooms,
                maxOnlinePlayers: updatedSettings.capacity.maxOnlinePlayers,
                capacityAdmissionMode: updatedSettings.capacity.admissionMode,
                capacityWarningThresholdPercent:
                    updatedSettings.capacity.warningThresholdPercent,
                capacityCriticalThresholdPercent:
                    updatedSettings.capacity.criticalThresholdPercent,
                emailVerificationMode:
                    updatedSettings.security.emailVerification.mode,
            },
            request: req,
        });

        return NextResponse.json({
            settings: updatedSettings,
            captchaReadiness: getCaptchaProviderReadiness(),
            emailReadiness: getOutboundEmailReadiness(),
            namespaces: [...SYSTEM_SETTINGS_NAMESPACES],
        }, { headers: buildRateLimitHeaders(rateLimit) });
    } catch (error) {
        return NextResponse.json(
            { error: error instanceof Error ? error.message : "Sistem ayarlari guncellenemedi." },
            {
                status: 422,
                headers: buildRateLimitHeaders(rateLimit),
            }
        );
    }
}
