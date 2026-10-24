import type { AppLocale } from "@/lib/i18n/config";
import { translate, type TranslationKey } from "@/lib/i18n/dictionaries";

/**
 * Notifications keep their Turkish text for admin and audit views and, in
 * `metadata.template` ({ id, params }), the template that renders them in the
 * reader's locale. Rows without a valid template (all older rows) show the
 * stored text. packages/platform-payments writes the same shape with literal
 * ids; scripts/test-notification-templates.ts checks every id in the code.
 */
export type NotificationTemplateParams = Record<string, string | number | boolean>;

interface NotificationTemplateDefinition {
    title: TranslationKey;
    /** Returns null (or is omitted) when the stored body is staff-written free text. */
    body?: (params: Readonly<Record<string, string>>) => TranslationKey | null;
    actionLabel?: TranslationKey;
    /** Params that must be non-empty for the template to render. */
    required: readonly string[];
}

const NOTIFICATION_TEMPLATES = {
    inventoryGranted: {
        title: "notifications.templates.inventoryGrantedTitle",
        body: () => "notifications.templates.inventoryGrantedBody",
        actionLabel: "notifications.templates.openInventory",
        required: ["item"],
    },
    inventoryRevoked: {
        title: "notifications.templates.inventoryRevokedTitle",
        body: () => "notifications.templates.inventoryRevokedBody",
        required: ["item"],
    },
    coinGrantRedeemed: {
        title: "notifications.templates.coinGrantRedeemedTitle",
        body: () => "notifications.templates.coinGrantRedeemedBody",
        actionLabel: "notifications.templates.openStore",
        required: ["amount"],
    },
    itemPurchased: {
        title: "notifications.templates.itemPurchasedTitle",
        body: (params) =>
            params.coupon
                ? "notifications.templates.itemPurchasedWithCouponBody"
                : "notifications.templates.itemPurchasedBody",
        actionLabel: "notifications.templates.openInventory",
        required: ["item"],
    },
    bundlePurchased: {
        title: "notifications.templates.bundlePurchasedTitle",
        body: (params) =>
            params.coupon
                ? "notifications.templates.bundlePurchasedWithCouponBody"
                : "notifications.templates.bundlePurchasedBody",
        actionLabel: "notifications.templates.openInventory",
        required: ["bundle"],
    },
    supportResolved: {
        title: "notifications.templates.supportResolvedTitle",
        body: () => "notifications.templates.supportResolvedBody",
        actionLabel: "notifications.openSupport",
        required: ["ticket"],
    },
    supportClosed: {
        title: "notifications.templates.supportClosedTitle",
        body: () => "notifications.templates.supportClosedBody",
        actionLabel: "notifications.openSupport",
        required: ["ticket"],
    },
    supportReply: {
        title: "notifications.templates.supportReplyTitle",
        actionLabel: "notifications.openSupport",
        required: [],
    },
    paymentFulfilled: {
        title: "notifications.templates.paymentFulfilledTitle",
        body: () => "notifications.templates.paymentFulfilledBody",
        actionLabel: "notifications.templates.openInventory",
        required: ["product"],
    },
    paymentReviewUpdated: {
        title: "notifications.templates.paymentReviewUpdatedTitle",
        body: (params) =>
            params.defaultNotice === "true" ? "notifications.templates.paymentReviewCompletedBody" : null,
        required: [],
    },
    paymentRefunded: {
        title: "notifications.templates.paymentRefundedTitle",
        body: (params) =>
            params.underReview === "true"
                ? "notifications.templates.paymentUnderReviewBody"
                : "notifications.templates.paymentEntitlementUpdatedBody",
        required: ["product"],
    },
    paymentChargeback: {
        title: "notifications.templates.paymentChargebackTitle",
        body: (params) =>
            params.underReview === "true"
                ? "notifications.templates.paymentUnderReviewBody"
                : "notifications.templates.paymentEntitlementUpdatedBody",
        required: ["product"],
    },
    /** A refunded order that later turns into a chargeback. */
    paymentChargebackRecorded: {
        title: "notifications.templates.paymentChargebackTitle",
        body: () => "notifications.templates.paymentStatusUpdatedBody",
        required: ["product"],
    },
} as const satisfies Record<string, NotificationTemplateDefinition>;

export type NotificationTemplateId = keyof typeof NOTIFICATION_TEMPLATES;

export const NOTIFICATION_TEMPLATE_IDS = Object.keys(NOTIFICATION_TEMPLATES) as NotificationTemplateId[];

// A type alias, not an interface, so it stays assignable to Prisma's JSON input type.
export type NotificationTemplateRef = {
    id: NotificationTemplateId;
    params: NotificationTemplateParams;
};

export function notificationTemplate(
    id: NotificationTemplateId,
    params: NotificationTemplateParams = {}
): NotificationTemplateRef {
    return { id, params };
}

const MAX_TEMPLATE_PARAMS = 8;
const MAX_TEMPLATE_PARAM_LENGTH = 160;

function isRecord(value: unknown): value is Record<string, unknown> {
    return typeof value === "object" && value !== null && !Array.isArray(value);
}

/** The template stored in a notification's metadata, or null when it is missing or malformed. */
export function parseNotificationTemplate(
    metadata: unknown
): { id: NotificationTemplateId; params: Readonly<Record<string, string>> } | null {
    if (!isRecord(metadata) || !isRecord(metadata.template)) return null;
    const { id, params } = metadata.template;
    if (typeof id !== "string" || !Object.hasOwn(NOTIFICATION_TEMPLATES, id)) return null;

    // Keys come from stored JSON, so collect them on an object without a prototype.
    const values: Record<string, string> = Object.create(null);
    if (params !== undefined) {
        if (!isRecord(params)) return null;
        const entries = Object.entries(params);
        if (entries.length > MAX_TEMPLATE_PARAMS) return null;
        for (const [key, value] of entries) {
            if (typeof value === "string") values[key] = value.slice(0, MAX_TEMPLATE_PARAM_LENGTH);
            else if (typeof value === "number" && Number.isFinite(value)) values[key] = String(value);
            else if (typeof value === "boolean") values[key] = value ? "true" : "";
            else return null;
        }
    }

    const templateId = id as NotificationTemplateId;
    const definition: NotificationTemplateDefinition = NOTIFICATION_TEMPLATES[templateId];
    if (definition.required.some((key) => !values[key])) return null;
    return { id: templateId, params: values };
}

export interface NotificationText {
    title: string;
    body: string;
    actionLabel: string | null;
}

/** The notification text in `locale`; the stored text when the row has no usable template. */
export function renderNotificationText(
    stored: NotificationText,
    metadata: unknown,
    locale: AppLocale
): NotificationText {
    const template = parseNotificationTemplate(metadata);
    if (!template) return stored;
    const definition: NotificationTemplateDefinition = NOTIFICATION_TEMPLATES[template.id];
    const bodyKey = definition.body?.(template.params) ?? null;
    return {
        title: translate(locale, definition.title, template.params),
        body: bodyKey ? translate(locale, bodyKey, template.params) : stored.body,
        actionLabel:
            stored.actionLabel !== null && definition.actionLabel
                ? translate(locale, definition.actionLabel)
                : stored.actionLabel,
    };
}
