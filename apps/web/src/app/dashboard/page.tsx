import { redirect } from "next/navigation";
import { isEmailVerificationRestrictionActive } from "@hushle/platform-auth";
import { AuthenticatedDashboardHome } from "@/components/game/authenticated-dashboard-home";
import type { DashboardTab } from "@/components/game/dashboard-nav";
import { getSessionUser } from "@/lib/session";

interface DashboardPageProps {
  searchParams: Promise<{
    tab?: string;
  }>;
}

const allowedTabs = new Set<DashboardTab>(["play", "dash", "inventory", "shop", "settings"]);

function resolveDashboardTab(tab: string | undefined): DashboardTab {
  if (tab && allowedTabs.has(tab as DashboardTab)) {
    return tab as DashboardTab;
  }

  return "dash";
}

export default async function DashboardPage({ searchParams }: DashboardPageProps) {
  const sessionUser = await getSessionUser();
  if (!sessionUser) {
    redirect("/login?callbackUrl=/dashboard");
  }
  if (isEmailVerificationRestrictionActive(sessionUser)) {
    redirect("/verify-email?required=1");
  }

  const { tab } = await searchParams;
  return <AuthenticatedDashboardHome defaultTab={resolveDashboardTab(tab)} />;
}
