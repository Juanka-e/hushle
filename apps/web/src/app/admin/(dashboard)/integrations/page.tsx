import {
    Boxes,
    Cloud,
    Database,
    KeyRound,
    Mail,
    ShoppingBag,
    ShieldCheck,
} from "lucide-react";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { getIntegrationHubSnapshot, type IntegrationItem, type IntegrationStatus } from "@/lib/integrations/service";

const categoryMeta = {
    runtime: {
        label: "Runtime",
        icon: Database,
        description: "Database, auth core ve temel ortam baglantilari.",
    },
    security: {
        label: "Security",
        icon: ShieldCheck,
        description: "Captcha ve benzeri dogrulama katmanlari.",
    },
    access: {
        label: "Access",
        icon: KeyRound,
        description: "Admin erisim politikasi ve gateway readiness.",
    },
    messaging: {
        label: "Messaging",
        icon: Mail,
        description: "Kullaniciya ulasan provider katmanlari.",
    },
    storage: {
        label: "Storage",
        icon: Boxes,
        description: "Asset storage ve gelecekteki shared runtime store'lar.",
    },
    commerce: {
        label: "Commerce",
        icon: ShoppingBag,
        description: "Checkout provider adapter ve secret readiness durumu.",
    },
} as const;

function statusClasses(status: IntegrationStatus): string {
    switch (status) {
        case "ready":
            return "bg-emerald-500/12 text-emerald-600 border-emerald-500/20";
        case "partial":
            return "bg-amber-500/12 text-amber-600 border-amber-500/20";
        case "missing":
            return "bg-rose-500/12 text-rose-600 border-rose-500/20";
        case "planned":
            return "bg-sky-500/12 text-sky-600 border-sky-500/20";
    }
}

function statusLabel(status: IntegrationStatus): string {
    switch (status) {
        case "ready":
            return "Ready";
        case "partial":
            return "Partial";
        case "missing":
            return "Missing";
        case "planned":
            return "Planned";
    }
}

function IntegrationCard({ item }: { item: IntegrationItem }) {
    return (
        <Card className="border-border/60 bg-card/70">
            <CardHeader className="gap-3">
                <div className="flex items-start justify-between gap-4">
                    <div className="space-y-1">
                        <CardTitle className="text-base">{item.title}</CardTitle>
                        <CardDescription>{item.summary}</CardDescription>
                    </div>
                    <span
                        className={`inline-flex rounded-full border px-2.5 py-1 text-[11px] font-bold uppercase tracking-[0.16em] ${statusClasses(item.status)}`}
                    >
                        {statusLabel(item.status)}
                    </span>
                </div>
            </CardHeader>
            <CardContent>
                <ul className="space-y-2 text-sm text-muted-foreground">
                    {item.details.map((detail) => (
                        <li key={detail} className="rounded-xl border border-border/60 bg-muted/20 px-3 py-2">
                            {detail}
                        </li>
                    ))}
                </ul>
            </CardContent>
        </Card>
    );
}

export default async function AdminIntegrationsPage() {
    const snapshot = await getIntegrationHubSnapshot();

    const groupedItems = Object.entries(categoryMeta).map(([categoryKey, meta]) => ({
        key: categoryKey as keyof typeof categoryMeta,
        ...meta,
        items: snapshot.items.filter((item) => item.category === categoryKey),
    }));

    return (
        <div className="space-y-8">
            <div className="flex flex-col gap-3 md:flex-row md:items-end md:justify-between">
                <div className="space-y-2">
                    <div className="inline-flex items-center gap-2 rounded-full border border-sky-500/20 bg-sky-500/10 px-3 py-1 text-[11px] font-bold uppercase tracking-[0.18em] text-sky-600">
                        <Cloud className="h-3.5 w-3.5" />
                        Integration Hub
                    </div>
                    <h1 className="text-3xl font-black tracking-tight text-foreground">Integrations</h1>
                    <p className="max-w-3xl text-sm text-muted-foreground">
                        Harici baglantilar, runtime provider readiness ve production oncesi wiring durumu tek panelde gorunur.
                        Secret degerler burada gosterilmez; sadece yapinin hazir olup olmadigi net olarak izlenir.
                    </p>
                </div>
            </div>

            <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-3 2xl:grid-cols-6">
                {groupedItems.map((section) => {
                    const Icon = section.icon;
                    return (
                        <Card key={section.key} className="border-border/60 bg-card/70">
                            <CardContent className="flex items-start gap-3 p-5">
                                <div className="rounded-2xl border border-border/70 bg-muted/30 p-3">
                                    <Icon className="h-5 w-5 text-foreground" />
                                </div>
                                <div className="space-y-1">
                                    <div className="text-sm font-bold text-foreground">{section.label}</div>
                                    <div className="text-xs text-muted-foreground">{section.description}</div>
                                    <div className="pt-1 text-[11px] font-semibold uppercase tracking-[0.16em] text-muted-foreground">
                                        {section.items.length} item
                                    </div>
                                </div>
                            </CardContent>
                        </Card>
                    );
                })}
            </div>

            <div className="space-y-8">
                {groupedItems.map((section) => (
                    <section key={section.key} className="space-y-4">
                        <div className="space-y-1">
                            <h2 className="text-xl font-black tracking-tight text-foreground">{section.label}</h2>
                            <p className="text-sm text-muted-foreground">{section.description}</p>
                        </div>
                        <div className="grid gap-4 xl:grid-cols-2">
                            {section.items.map((item) => (
                                <IntegrationCard key={item.id} item={item} />
                            ))}
                        </div>
                    </section>
                ))}
            </div>
        </div>
    );
}
