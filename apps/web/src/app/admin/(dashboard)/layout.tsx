import { redirect } from "next/navigation";
import { AdminSidebar } from "@/components/admin/admin-sidebar";
import { requireAdminSession } from "@/lib/admin/require-admin";

export default async function AdminDashboardLayout({
    children,
}: {
    children: React.ReactNode;
}) {
    const session = await requireAdminSession();
    if (session instanceof Response) {
        redirect("/admin/login");
    }

    return (
        <div className="min-h-screen bg-background flex">
            <AdminSidebar username={session.name || "Admin"} />
            <main className="flex-1 p-6 md:p-8 overflow-y-auto">{children}</main>
        </div>
    );
}
