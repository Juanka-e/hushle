"use client";

import Link from "next/link";
import { usePathname, useSearchParams } from "next/navigation";
import { signOut } from "next-auth/react";
import { Button } from "@/components/ui/button";

interface UserNavProps {
  username: string;
}

const navItems = [
  { href: "/dashboard", label: "Dashboard", matches: (pathname: string, tab: string | null) => pathname === "/dashboard" && (!tab || tab === "dash") },
  { href: "/dashboard?tab=settings", label: "Profil", matches: (pathname: string, tab: string | null) => pathname === "/dashboard" && tab === "settings" },
  { href: "/dashboard?tab=shop", label: "Magaza", matches: (pathname: string, tab: string | null) => pathname === "/dashboard" && tab === "shop" },
];

export function UserNav({ username }: UserNavProps) {
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const activeTab = searchParams.get("tab");

  return (
    <header className="sticky top-0 z-30 border-b border-zinc-200/60 dark:border-zinc-800/70 bg-white/80 dark:bg-zinc-950/70 backdrop-blur">
      <div className="mx-auto max-w-6xl px-4 py-3 flex items-center justify-between gap-4">
        <div className="flex items-center gap-6">
          <Link href="/" className="font-black tracking-tight text-lg">TABU</Link>
          <nav className="flex items-center gap-2">
            {navItems.map((item) => {
              const active = item.matches(pathname, activeTab);
              return (
                <Link
                  key={item.href}
                  href={item.href}
                  className={`px-3 py-1.5 rounded-md text-sm transition ${active ? "bg-black text-white dark:bg-white dark:text-black" : "text-zinc-700 hover:bg-zinc-100 dark:text-zinc-300 dark:hover:bg-zinc-800"}`}
                >
                  {item.label}
                </Link>
              );
            })}
          </nav>
        </div>

        <div className="flex items-center gap-2">
          <span className="text-sm text-zinc-600 dark:text-zinc-300 hidden sm:inline">{username}</span>
          <Button
            variant="outline"
            size="sm"
            onClick={() => void signOut({ callbackUrl: "/" })}
          >
            Cikis
          </Button>
        </div>
      </div>
    </header>
  );
}
