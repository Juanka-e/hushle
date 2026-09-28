"use client";

import {
    Book,
    Eye,
    Feather,
    Flame,
    Gamepad2,
    Hash,
    Info,
    Sparkles,
    Target,
    Trophy,
    User,
    Users,
    X,
} from "lucide-react";
import { useI18n } from "@/components/providers/i18n-provider";
import type { TranslationKey } from "@/lib/i18n/dictionaries";

interface RulesModalProps {
    isOpen: boolean;
    onClose: () => void;
}

const roles: Array<{
    icon: typeof User;
    title: TranslationKey;
    help: TranslationKey;
    color: string;
}> = [
    { icon: User, title: "rules.narrator", help: "rules.narratorHelp", color: "text-orange-600 bg-orange-100 dark:bg-orange-900/30" },
    { icon: Users, title: "rules.guessers", help: "rules.guessersHelp", color: "text-emerald-600 bg-emerald-100 dark:bg-emerald-900/30" },
    { icon: Eye, title: "rules.inspector", help: "rules.inspectorHelp", color: "text-red-600 bg-red-100 dark:bg-red-900/30" },
];

export function RulesModal({ isOpen, onClose }: RulesModalProps) {
    const { t } = useI18n();
    if (!isOpen) return null;

    return (
        <div className="fixed inset-0 z-[60] flex items-center justify-center bg-slate-900/60 p-4 backdrop-blur-sm animate-in fade-in duration-200">
            <div className="flex max-h-[85vh] w-full max-w-2xl flex-col overflow-hidden rounded-2xl border border-gray-100 bg-white shadow-2xl dark:border-slate-700 dark:bg-slate-800">
                <div className="sticky top-0 z-10 flex items-center justify-between border-b border-gray-100 bg-white p-5 dark:border-slate-700 dark:bg-slate-800">
                    <h3 className="flex items-center gap-2 text-xl font-black text-slate-800 dark:text-white">
                        <Book className="text-purple-500" size={24} /> {t("rules.title")}
                    </h3>
                    <button type="button" onClick={onClose} aria-label={t("common.close")} className="rounded-full p-2 text-gray-500 transition-colors hover:bg-gray-100 dark:hover:bg-slate-700">
                        <X size={20} />
                    </button>
                </div>

                <div className="space-y-8 overflow-y-auto p-6">
                    <section>
                        <SectionTitle icon={Info} title={t("rules.purposeTitle")} color="text-blue-500" />
                        <p className="ml-7 text-sm leading-relaxed text-gray-600 dark:text-gray-300">{t("rules.purpose")}</p>
                    </section>
                    <Divider />

                    <section>
                        <SectionTitle icon={Users} title={t("rules.rolesTitle")} color="text-purple-500" />
                        <div className="ml-7 grid gap-3">
                            {roles.map(({ icon: Icon, title, help, color }) => (
                                <div key={title} className="flex items-start gap-3">
                                    <div className={`mt-0.5 rounded-lg p-1.5 ${color}`}><Icon size={16} /></div>
                                    <div>
                                        <h5 className="text-sm font-bold text-slate-800 dark:text-white">{t(title)}</h5>
                                        <p className="text-xs text-gray-500 dark:text-gray-400">{t(help)}</p>
                                    </div>
                                </div>
                            ))}
                        </div>
                    </section>
                    <Divider />

                    <section>
                        <SectionTitle icon={Gamepad2} title={t("rules.modesTitle")} color="text-indigo-500" />
                        <div className="ml-7 grid grid-cols-1 gap-4 sm:grid-cols-2">
                            <RuleCard icon={Hash} title={t("rules.rounds")} help={t("rules.roundsHelp")} color="text-blue-500" />
                            <RuleCard icon={Trophy} title={t("rules.target")} help={t("rules.targetHelp")} color="text-amber-500" />
                        </div>
                        <div className="ml-7 mt-4 flex gap-3 rounded-xl border border-amber-100 bg-amber-50 p-3 dark:border-amber-800/50 dark:bg-amber-900/20">
                            <Sparkles className="shrink-0 text-amber-500" size={20} />
                            <div>
                                <h5 className="text-sm font-bold text-amber-700 dark:text-amber-400">{t("rules.golden")}</h5>
                                <p className="mt-1 text-xs text-amber-600/80 dark:text-amber-500/80">{t("rules.goldenHelp")}</p>
                            </div>
                        </div>
                    </section>
                    <Divider />

                    <section>
                        <SectionTitle icon={Target} title={t("rules.difficultyTitle")} color="text-rose-500" />
                        <p className="mb-3 ml-7 text-sm text-gray-600 dark:text-gray-300">{t("rules.difficultyHelp")}</p>
                        <div className="ml-7 flex flex-wrap gap-3">
                            <Difficulty icon={Feather} label={t("room.easy")} classes="border-blue-100 bg-blue-50 text-blue-700 dark:border-blue-800 dark:bg-blue-900/20 dark:text-blue-300" />
                            <Difficulty icon={Target} label={t("room.medium")} classes="border-purple-100 bg-purple-50 text-purple-700 dark:border-purple-800 dark:bg-purple-900/20 dark:text-purple-300" />
                            <Difficulty icon={Flame} label={t("room.hard")} classes="border-red-100 bg-red-50 text-red-700 dark:border-red-800 dark:bg-red-900/20 dark:text-red-300" />
                        </div>
                    </section>
                    <Divider />

                    <section>
                        <h4 className="mb-4 text-center text-lg font-bold text-slate-800 dark:text-white">{t("rules.scoring")}</h4>
                        <div className="grid grid-cols-3 gap-2 text-center">
                            <Score value="+1" label={t("game.correct")} color="text-green-500" />
                            <Score value="-1" label={t("rules.error")} color="text-red-500" />
                            <Score value="0" label={t("game.pass")} color="text-amber-500" />
                        </div>
                    </section>
                </div>

                <div className="border-t border-gray-100 bg-white p-5 dark:border-slate-700 dark:bg-slate-800">
                    <button type="button" onClick={onClose} className="w-full rounded-xl bg-slate-900 py-3 font-bold text-white transition-opacity hover:opacity-90 dark:bg-white dark:text-slate-900">
                        {t("rules.back")}
                    </button>
                </div>
            </div>
        </div>
    );
}

function SectionTitle({ icon: Icon, title, color }: { icon: typeof Info; title: string; color: string }) {
    return <div className="mb-3 flex items-center gap-2"><Icon className={color} size={20} /><h4 className="text-lg font-bold text-slate-800 dark:text-white">{title}</h4></div>;
}

function Divider() {
    return <hr className="border-gray-100 dark:border-slate-700" />;
}

function RuleCard({ icon: Icon, title, help, color }: { icon: typeof Info; title: string; help: string; color: string }) {
    return <div className="rounded-xl border border-gray-100 bg-gray-50 p-3 dark:border-slate-700 dark:bg-slate-700/50"><div className="mb-2 flex items-center gap-2"><Icon size={16} className={color} /><span className="text-sm font-bold dark:text-white">{title}</span></div><p className="text-xs leading-snug text-gray-500 dark:text-gray-400">{help}</p></div>;
}

function Difficulty({ icon: Icon, label, classes }: { icon: typeof Info; label: string; classes: string }) {
    return <div className={`flex items-center gap-2 rounded-lg border px-3 py-1.5 ${classes}`}><Icon size={16} /><span className="text-xs font-bold">{label}</span></div>;
}

function Score({ value, label, color }: { value: string; label: string; color: string }) {
    return <div className="rounded-xl border border-gray-100 bg-gray-50 p-3 dark:border-slate-700 dark:bg-slate-700/50"><div className={`text-2xl font-black ${color}`}>{value}</div><div className="mt-1 text-[10px] font-bold uppercase text-gray-400">{label}</div></div>;
}
