"use client";

import { useState } from "react";
import { prewarmCaptchaForAction } from "@/lib/security/captcha-client";
import { useI18n } from "@/components/providers/i18n-provider";

interface UsernamePromptProps {
    onConfirm: (username: string) => void;
}

export function UsernamePrompt({ onConfirm }: UsernamePromptProps) {
    const { t } = useI18n();
    const [value, setValue] = useState("");

    const handleConfirm = () => {
        const trimmed = value.trim();
        if (trimmed.length >= 2) {
            onConfirm(trimmed);
        }
    };

    return (
        <div className="fixed inset-0 z-[100] flex items-center justify-center bg-black/70 backdrop-blur-sm animate-fade-in">
            <div className="mx-4 w-full max-w-md rounded-2xl bg-white p-8 shadow-2xl animate-in zoom-in-95 dark:bg-slate-800">
                <h2 className="mb-2 text-center text-2xl font-bold text-slate-800 dark:text-white">
                    {t("guest.welcome")}
                </h2>
                <p className="mb-6 text-center text-gray-600 dark:text-gray-400">
                    {t("guest.description")}
                </p>
                <input
                    type="text"
                    value={value}
                    onChange={(event) => setValue(event.target.value.slice(0, 20))}
                    onKeyDown={(event) => {
                        if (event.key === "Enter" && value.trim().length >= 2) {
                            handleConfirm();
                        }
                    }}
                    placeholder={t("guest.placeholder")}
                    className="mb-4 w-full rounded-xl border-2 border-gray-200 bg-white px-4 py-3 text-slate-800 transition-colors focus:border-blue-500 focus:outline-none dark:border-slate-600 dark:bg-slate-900 dark:text-white"
                    autoFocus
                    maxLength={20}
                />
                <button
                    onClick={handleConfirm}
                    onFocus={() => prewarmCaptchaForAction("guest_join")}
                    onPointerEnter={() => prewarmCaptchaForAction("guest_join")}
                    disabled={value.trim().length < 2}
                    className="w-full rounded-xl bg-blue-600 py-3 font-bold text-white shadow-lg transition-all active:scale-[0.99] hover:bg-blue-700 disabled:cursor-not-allowed disabled:bg-gray-400"
                >
                    {t("guest.submit")}
                </button>
                <p className="mt-3 text-center text-xs text-gray-400">{t("guest.minimum")}</p>
            </div>
        </div>
    );
}
