import type { Metadata, Viewport } from "next";
import { Inter } from "next/font/google";
import { headers } from "next/headers";
import { cookies } from "next/headers";
import "./globals.css";
import { AuthProvider } from "@/components/providers/session-provider";
import { ThemeProvider } from "@/components/providers/theme-provider";
import { BrandingProvider } from "@/components/providers/branding-provider";
import { Toaster } from "@/components/ui/sonner";
import { GlobalRuntimeBanner } from "@/components/system/global-runtime-banner";
import { buildRootMetadata, buildRootViewport } from "@/lib/branding/metadata";
import { getSystemSettings } from "@/lib/system-settings/service";
import { I18nProvider } from "@/components/providers/i18n-provider";
import { LOCALE_COOKIE_NAME, normalizeAppLocale } from "@/lib/i18n/config";

const inter = Inter({
  variable: "--font-inter",
  subsets: ["latin"],
  display: "swap",
  fallback: ["system-ui", "-apple-system", "sans-serif"],
});

export async function generateMetadata(): Promise<Metadata> {
  const settings = await getSystemSettings();
  return buildRootMetadata(settings.branding);
}

export async function generateViewport(): Promise<Viewport> {
  const settings = await getSystemSettings();
  return buildRootViewport(settings.branding);
}

export default async function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  const requestHeaders = await headers();
  const cookieStore = await cookies();
  const locale = normalizeAppLocale(cookieStore.get(LOCALE_COOKIE_NAME)?.value);
  const nonce = requestHeaders.get("x-nonce") ?? undefined;
  const pathname = requestHeaders.get("x-pathname") ?? "/";
  const settings = await getSystemSettings();
  const isAdminPath = pathname.startsWith("/admin");
  const showMaintenanceBanner =
    settings.platform.maintenanceEnabled && !isAdminPath;
  const showMotdBanner =
    settings.platform.motdEnabled &&
    settings.platform.motdText.trim().length > 0 &&
    !isAdminPath;

  return (
    <html lang={locale} suppressHydrationWarning>
      <body className={`${inter.variable} font-sans antialiased`}>
        <AuthProvider>
          <I18nProvider initialLocale={locale}>
            <BrandingProvider branding={settings.branding}>
              <ThemeProvider nonce={nonce}>
                {showMaintenanceBanner ? (
                  <GlobalRuntimeBanner
                    tone="warning"
                    message={settings.platform.maintenanceMessage}
                  />
                ) : null}
                {showMotdBanner ? (
                  <GlobalRuntimeBanner
                    tone="info"
                    message={settings.platform.motdText}
                  />
                ) : null}
                {children}
                <Toaster />
              </ThemeProvider>
            </BrandingProvider>
          </I18nProvider>
        </AuthProvider>
      </body>
    </html>
  );
}
