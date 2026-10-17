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
    FlaskConical,
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
    { href: "/admin/users", icon: Users, label: "Kullanıcılar" },
    { href: "/admin/support", icon: Headset, label: "Support" },
    { href: "/admin/email-delivery", icon: MailWarning, label: "E-posta Teslimatı" },
    { href: "/admin/payments", icon: CreditCard, label: "Ödemeler" },
    { href: "/admin/audit", icon: Activity, label: "Audit" },
    { href: "/admin/lab", icon: FlaskConical, label: "Lab" },
    { href: "/admin/integrations", icon: PlugZap, label: "Integrations" },
    { href: "/admin/system-settings", icon: SlidersHorizontal, label: "Sistem Ayarları" },
    { href: "/admin/announcements", icon: Megaphone, label: "Duyurular" },
];

interface AdminSidebarProps {
    username: string;
}

export function AdminSidebar({ username }: AdminSidebarProps) {
    const pathname = usePathname();

    return (
        // Below md the sidebar is an icon rail, so phone screens keep room for the page.
        <aside className="sticky top-0 flex h-screen w-16 shrink-0 flex-col border-r border-border bg-card/50 md:w-64">
            <div className="flex items-center justify-center gap-3 p-3 md:justify-start md:p-4">
                <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-gradient-to-br from-purple-500 to-blue-600">
                    <Gamepad2 className="h-5 w-5 text-white" />
                </div>
                <div className="hidden md:block">
                    <h2 className="text-sm font-bold text-foreground">Tabu Admin</h2>
                    <p className="text-xs text-muted-foreground">{username}</p>
                </div>
            </div>

            <Separator />

            <nav className="flex-1 space-y-1 overflow-y-auto p-2 md:p-3">
                {navItems.map(({ href, icon: Icon, label }) => {
                    const isActive = href === "/admin" ? pathname === "/admin" : pathname.startsWith(href);

                    return (
                        <Link
                            key={href}
                            href={href}
                            title={label}
                            className={`flex items-center justify-center gap-3 rounded-lg px-3 py-2.5 text-sm font-medium transition-colors md:justify-start ${
                                isActive
                                    ? "bg-primary/10 text-primary"
                                    : "text-muted-foreground hover:bg-muted hover:text-foreground"
                            }`}
                        >
                            <Icon aria-hidden="true" className="h-4 w-4 shrink-0" />
                            <span className="sr-only md:not-sr-only">{label}</span>
                        </Link>
                    );
                })}
            </nav>

            <Separator />

            <div className="p-2 md:p-3">
                <Link href="/" title="Oyuna Dön">
                    <Button
                        variant="ghost"
                        className="w-full justify-center gap-3 text-sm text-muted-foreground md:justify-start"
                    >
                        <Gamepad2 aria-hidden="true" className="h-4 w-4" />
                        <span className="sr-only md:not-sr-only">Oyuna Dön</span>
                    </Button>
                </Link>
                <Button
                    variant="ghost"
                    className="w-full justify-center gap-3 text-sm text-destructive hover:text-destructive md:justify-start"
                    title="Çıkış Yap"
                    onClick={() => signOut({ callbackUrl: "/admin/login" })}
                >
                    <LogOut aria-hidden="true" className="h-4 w-4" />
                    <span className="sr-only md:not-sr-only">Çıkış Yap</span>
                </Button>
            </div>
        </aside>
    );
}
