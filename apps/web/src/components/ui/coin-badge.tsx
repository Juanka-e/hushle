"use client";

import { Coins } from "lucide-react";
import { cn } from "@/lib/utils";

interface CoinMarkProps {
    iconClassName?: string;
    className?: string;
}

interface CoinBadgeProps {
    value: number;
    label?: string;
    className?: string;
    valueClassName?: string;
}

export function CoinMark({ iconClassName, className }: CoinMarkProps) {
    return (
        <div
            className={cn(
                "flex h-8 w-8 items-center justify-center rounded-full border border-yellow-500/30 bg-gradient-to-b from-yellow-300 via-amber-400 to-yellow-600 shadow-inner ring-2 ring-yellow-100/70 dark:ring-yellow-900/40",
                className
            )}
        >
            <Coins className={cn("h-4 w-4 text-yellow-50 drop-shadow-sm", iconClassName)} />
        </div>
    );
}

export function CoinBadge({
    value,
    label = "Coins",
    className,
    valueClassName,
}: CoinBadgeProps) {
    return (
        <div
            className={cn(
                "flex items-center gap-3 rounded-xl border border-amber-200 bg-amber-50 px-4 py-2 shadow-sm dark:border-amber-700/30 dark:bg-amber-900/20",
                className
            )}
        >
            <CoinMark />
            <div className="flex min-w-0 flex-col">
                <span className="text-[10px] font-bold uppercase tracking-wider text-amber-600 dark:text-amber-500">
                    {label}
                </span>
                <span className={cn("text-lg font-black leading-none text-slate-800 dark:text-white", valueClassName)}>
                    {value.toLocaleString()}
                </span>
            </div>
        </div>
    );
}
