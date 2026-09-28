import { z } from "zod";
import { EMAIL_VERIFICATION_MODES } from "@hushle/platform-email";
import {
    CAPTCHA_FAIL_MODES,
    CAPTCHA_PROVIDERS,
    CAPTCHA_TURNSTILE_MODES,
    CAPACITY_ADMISSION_MODES,
    ECONOMY_DAMPING_PROFILES,
    type SystemSettings,
} from "@/types/system-settings";

const trimmedShortText = z.string().trim().max(240);
const trimmedLongText = z.string().trim().max(400);

const platformSettingsSchema = z.object({
    maintenanceEnabled: z.boolean().default(false),
    maintenanceMessage: trimmedLongText.default("Bakim calismasi var. Lutfen daha sonra tekrar deneyin."),
    motdEnabled: z.boolean().default(false),
    motdText: trimmedShortText.default(""),
});

const hexColorSchema = z
    .string()
    .trim()
    .regex(/^#(?:[0-9a-fA-F]{3}){1,2}$/, "Gecerli bir hex renk gir.")
    .default("#101828");

const brandingSettingsSchema = z.object({
    siteName: z.string().trim().min(2).max(80).default("Tabu Oyunu"),
    siteShortName: z.string().trim().min(2).max(32).default("Tabu"),
    logoUrl: z.string().trim().max(255).default(""),
    defaultTitle: z
        .string()
        .trim()
        .min(5)
        .max(120)
        .default("Tabu Oyunu | Online Sozcuk Tahmin Oyunu"),
    titleTemplate: z.string().trim().min(3).max(80).default("%s | Tabu Oyunu"),
    defaultDescription: z
        .string()
        .trim()
        .min(12)
        .max(240)
        .default("Arkadaslarinla online Tabu oyna. Modern arayuz, hizli odalar ve yeni nesil kelime tahmin deneyimi."),
    ogImageUrl: z.string().trim().max(255).default(""),
    faviconUrl: z.string().trim().max(255).default("/favicon.ico"),
    themeColor: hexColorSchema,
    twitterHandle: z.string().trim().max(50).default(""),
});

const featureSettingsSchema = z.object({
    registrationsEnabled: z.boolean().default(true),
    guestGameplayEnabled: z.boolean().default(true),
    roomCreateEnabled: z.boolean().default(true),
    roomJoinEnabled: z.boolean().default(true),
    storeEnabled: z.boolean().default(true),
});

const economySettingsSchema = z.object({
    startingCoinBalance: z.number().int().min(0).max(1_000_000).default(0),
    winRewardCoin: z.number().int().min(0).max(1_000_000).default(120),
    lossRewardCoin: z.number().int().min(0).max(1_000_000).default(40),
    drawRewardCoin: z.number().int().min(0).max(1_000_000).default(40),
    matchCoinMultiplier: z.number().min(0).max(10).default(1),
    weekendCoinMultiplierEnabled: z.boolean().default(false),
    weekendCoinMultiplier: z.number().min(1).max(10).default(1.5),
    storePriceMultiplier: z.number().min(0.1).max(10).default(1),
    bundlesEnabled: z.boolean().default(true),
    discountCampaignsEnabled: z.boolean().default(true),
    couponsEnabled: z.boolean().default(true),
    matchRewardGuardEnabled: z.boolean().default(true),
    matchRewardWindowHours: z.number().int().min(1).max(168).default(24),
    matchRewardSoftCapCoin: z.number().int().min(0).max(100_000).default(3600),
    matchRewardHardCapCoin: z.number().int().min(0).max(100_000).default(5200),
    matchRewardMinMultiplier: z.number().min(0).max(1).default(0.35),
    matchRewardDampingProfile: z.enum(ECONOMY_DAMPING_PROFILES).default("gentle"),
    repeatedGroupEnabled: z.boolean().default(true),
    repeatedGroupWindowHours: z.number().int().min(1).max(168).default(12),
    repeatedGroupThreshold: z.number().int().min(2).max(100).default(8),
    repeatedGroupMinMultiplier: z.number().min(0).max(1).default(0.55),
});

const capacitySettingsSchema = z
    .object({
        roomMaxPlayers: z.number().int().min(4).max(20).default(10),
        teamMaxPlayers: z.number().int().min(2).max(10).default(5),
        maxActiveRooms: z.number().int().min(1).max(100_000).default(500),
        maxOnlinePlayers: z.number().int().min(2).max(1_000_000).default(5_000),
        warningThresholdPercent: z.number().int().min(10).max(95).default(75),
        criticalThresholdPercent: z.number().int().min(20).max(100).default(90),
        admissionMode: z.enum(CAPACITY_ADMISSION_MODES).default("automatic"),
        capacityMessage: trimmedLongText.default(
            "Sunucu su anda yogun. Devam eden oyunlari korumak icin yeni oda islemleri gecici olarak sinirlandirildi. Lutfen kisa sure sonra tekrar deneyin."
        ),
    })
    .refine(
        (settings) => settings.teamMaxPlayers * 2 >= settings.roomMaxPlayers,
        {
            message: "Takim kapasitesi toplam oda kapasitesini karsilamali.",
            path: ["teamMaxPlayers"],
        }
    )
    .refine(
        (settings) =>
            settings.warningThresholdPercent < settings.criticalThresholdPercent,
        {
            message: "Uyari esigi kritik esikten dusuk olmali.",
            path: ["warningThresholdPercent"],
        }
    );

const captchaSettingsSchema = z.object({
    enabled: z.boolean().default(false),
    provider: z.enum(CAPTCHA_PROVIDERS).default("turnstile"),
    onRegister: z.boolean().default(true),
    onGuestJoin: z.boolean().default(false),
    onRoomCreate: z.boolean().default(true),
    onLogin: z.boolean().default(false),
    failMode: z.enum(CAPTCHA_FAIL_MODES).default("hard_fail"),
    turnstileMode: z.enum(CAPTCHA_TURNSTILE_MODES).default("managed"),
    recaptchaScoreThreshold: z.number().min(0).max(1).default(0.5),
    turnstileInteractiveFallback: z.boolean().default(true),
});

const securitySettingsSchema = z.object({
    captcha: captchaSettingsSchema.default(captchaSettingsSchema.parse({})),
    emailVerification: z
        .object({
            mode: z.enum(EMAIL_VERIFICATION_MODES).default("optional"),
        })
        .default({ mode: "optional" }),
});

export const systemSettingsSchema = z.object({
    platform: platformSettingsSchema.default(platformSettingsSchema.parse({})),
    branding: brandingSettingsSchema.default(brandingSettingsSchema.parse({})),
    features: featureSettingsSchema.default(featureSettingsSchema.parse({})),
    economy: economySettingsSchema.default(economySettingsSchema.parse({})),
    capacity: capacitySettingsSchema.default(capacitySettingsSchema.parse({})),
    security: securitySettingsSchema.default(securitySettingsSchema.parse({})),
});

export const systemSettingsWriteSchema = z.object({
    platform: platformSettingsSchema,
    branding: brandingSettingsSchema,
    features: featureSettingsSchema,
    economy: economySettingsSchema,
    capacity: capacitySettingsSchema,
    security: securitySettingsSchema,
});

export type SystemSettingsNamespace = keyof SystemSettings;

export const SYSTEM_SETTINGS_NAMESPACES = [
    "platform",
    "branding",
    "features",
    "economy",
    "capacity",
    "security",
] as const satisfies readonly SystemSettingsNamespace[];

export const DEFAULT_SYSTEM_SETTINGS = systemSettingsSchema.parse({}) satisfies SystemSettings;

export function normalizeSystemSettings(input: unknown): SystemSettings {
    const parsed = systemSettingsSchema.parse(input);
    const normalizedEconomy = {
        ...parsed.economy,
        matchRewardHardCapCoin: Math.max(parsed.economy.matchRewardSoftCapCoin, parsed.economy.matchRewardHardCapCoin),
    };

    if (parsed.security.captcha.provider === "none") {
        return {
            ...parsed,
            economy: normalizedEconomy,
            security: {
                ...parsed.security,
                captcha: {
                    ...parsed.security.captcha,
                    provider: "turnstile",
                },
            },
        };
    }

    return {
        ...parsed,
        economy: normalizedEconomy,
    };
}
