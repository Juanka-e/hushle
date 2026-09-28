"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { signOut } from "next-auth/react";
import {
    LayoutDashboard,
    BookOpen,
    FolderTree,
    Megaphone,
    LogOut,
    Gamepad2,
    ShoppingBag,
    Shirt,
    TicketPercent,
    SlidersHorizontal,
    Activity,
    Users,
    Gift,
    Headset,
    PlugZap,
    MailWarning,
    CreditCard,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Separator } from "@/components/ui/separator";

const navItems = [
    { href: "/admin", icon: LayoutDashboard, label: "Dashboard" },
    { href: "/admin/words", icon: BookOpen, label: "Kelimeler" },
    { href: "/admin/categories", icon: FolderTree, label: "Kategoriler" },
    { href: "/admin/shop-items", icon: ShoppingBag, label: "Kozmetikler" },
    { href: "/admin/inventory", icon: Shirt, label: "Envanter" },
    { href: "/admin/promotions", icon: TicketPercent, label: "Promosyonlar" },
    { href: "/admin/coin-grants", icon: Gift, label: "Coin Grants" },
    { href: "/admin/users", icon: Users, label: "Kullanicilar" },
    { href: "/admin/support", icon: Headset, label: "Support" },
    { href: "/admin/email-delivery", icon: MailWarning, label: "E-posta Teslimatı" },
    { href: "/admin/payments", icon: CreditCard, label: "Ödemeler" },
    { href: "/admin/audit", icon: Activity, label: "Audit" },
    { href: "/admin/integrations", icon: PlugZap, label: "Integrations" },
    { href: "/admin/system-settings", icon: SlidersHorizontal, label: "Sistem Ayarlari" },
    { href: "/admin/announcements", icon: Megaphone, label: "Duyurular" },
];

interface AdminSidebarProps {
    username: string;
}

export function AdminSidebar({ username }: AdminSidebarProps) {
    const pathname = usePathname();

    return (
        <aside className="sticky top-0 flex h-screen w-64 flex-col border-r border-border bg-card/50">
            <div className="flex items-center gap-3 p-4">
                <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-gradient-to-br from-purple-500 to-blue-600">
                    <Gamepad2 className="h-5 w-5 text-white" />
                </div>
                <div>
                    <h2 className="text-sm font-bold text-foreground">Tabu Admin</h2>
                    <p className="text-xs text-muted-foreground">{username}</p>
                </div>
            </div>

            <Separator />

            <nav className="flex-1 space-y-1 p-3">
                {navItems.map(({ href, icon: Icon, label }) => {
                    const isActive = href === "/admin" ? pathname === "/admin" : pathname.startsWith(href);

                    return (
                        <Link
                            key={href}
                            href={href}
                            className={`flex items-center gap-3 rounded-lg px-3 py-2.5 text-sm font-medium transition-colors ${
                                isActive
                                    ? "bg-primary/10 text-primary"
                                    : "text-muted-foreground hover:bg-muted hover:text-foreground"
                            }`}
                        >
                            <Icon className="h-4 w-4" />
                            {label}
                        </Link>
                    );
                })}
            </nav>

            <Separator />

            <div className="p-3">
                <Link href="/">
                    <Button
                        variant="ghost"
                        className="w-full justify-start gap-3 text-sm text-muted-foreground"
                    >
                        <Gamepad2 className="h-4 w-4" />
                        Oyuna Don
                    </Button>
                </Link>
                <Button
                    variant="ghost"
                    className="w-full justify-start gap-3 text-sm text-destructive hover:text-destructive"
                    onClick={() => signOut({ callbackUrl: "/admin/login" })}
                >
                    <LogOut className="h-4 w-4" />
                    Cikis Yap
                </Button>
            </div>
        </aside>
    );
}
