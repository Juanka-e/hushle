import { FlaskConical } from "lucide-react";
import { AdminPageHeader } from "@/components/admin/admin-page-header";
import { ConnectionPauseCard } from "@/components/admin/lab/connection-pause-card";

export default function AdminLabPage() {
    return (
        <div className="space-y-6">
            <AdminPageHeader
                title="Lab"
                description="Oyun içi davranış verileri. Kişisel veri tutulmaz."
                meta="Toplu günlük sayaçlar"
                icon={<FlaskConical className="h-5 w-5 text-violet-500" />}
            />
            <ConnectionPauseCard />
        </div>
    );
}
