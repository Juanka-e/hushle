import Google from "next-auth/providers/google";
import type { Provider } from "next-auth/providers";

export const OAUTH_PROVIDER_IDS = ["google"] as const;
export type OAuthProviderId = (typeof OAUTH_PROVIDER_IDS)[number];

export interface OAuthProviderDescriptor {
    id: OAuthProviderId;
    label: string;
    enabled: boolean;
}

function isExplicitlyEnabled(value: string | undefined): boolean {
    return value?.trim().toLowerCase() === "true";
}

export function getOAuthProviderDescriptors(): OAuthProviderDescriptor[] {
    return [
        {
            id: "google",
            label: "Google",
            enabled:
                isExplicitlyEnabled(process.env.GOOGLE_OAUTH_ENABLED) &&
                Boolean(process.env.AUTH_GOOGLE_ID?.trim()) &&
                Boolean(process.env.AUTH_GOOGLE_SECRET?.trim()),
        },
    ];
}

export function getEnabledOAuthProviders(): Provider[] {
    const google = getOAuthProviderDescriptors().find(
        (provider) => provider.id === "google"
    );
    if (!google?.enabled) {
        return [];
    }

    return [
        Google({
            clientId: process.env.AUTH_GOOGLE_ID,
            clientSecret: process.env.AUTH_GOOGLE_SECRET,
            allowDangerousEmailAccountLinking: false,
            account() {
                // Hushle does not call Google APIs, so provider tokens are not persisted.
                return {};
            },
        }),
    ];
}

export function isKnownOAuthProvider(value: string): value is OAuthProviderId {
    return OAUTH_PROVIDER_IDS.includes(value as OAuthProviderId);
}
