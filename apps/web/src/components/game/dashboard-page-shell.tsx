"use client";

import type { ReactNode } from "react";
import { cn } from "@/lib/utils";

interface DashboardPageShellProps {
  eyebrow?: string;
  title: string;
  description?: string;
  action?: ReactNode;
  children: ReactNode;
  className?: string;
}

interface DashboardSectionProps {
  title?: string;
  description?: string;
  action?: ReactNode;
  children: ReactNode;
  className?: string;
  contentClassName?: string;
}

interface DashboardEmptyStateProps {
  title: string;
  description: string;
  icon?: ReactNode;
  className?: string;
}

export function DashboardPageShell({
  eyebrow,
  title,
  description,
  action,
  children,
  className,
}: DashboardPageShellProps) {
  return (
    <div className={cn("mx-auto flex h-full w-full max-w-[1480px] flex-col px-4 py-5 md:px-6 md:py-6 xl:px-8", className)}>
      <header className="mb-6 flex flex-col gap-4 rounded-[28px] border border-white/60 bg-white/72 px-5 py-5 shadow-[0_20px_60px_-36px_rgba(15,23,42,0.45)] backdrop-blur-xl dark:border-slate-800/70 dark:bg-slate-950/45 md:px-6 md:py-6">
        <div className="flex flex-col gap-4 lg:flex-row lg:items-start lg:justify-between">
          <div className="min-w-0">
            {eyebrow ? (
              <div className="mb-2 text-[11px] font-black uppercase tracking-[0.24em] text-sky-600 dark:text-sky-300">
                {eyebrow}
              </div>
            ) : null}
            <h1 className="text-3xl font-black tracking-tight text-slate-900 dark:text-white md:text-4xl">
              {title}
            </h1>
            {description ? (
              <p className="mt-2 max-w-3xl text-sm leading-6 text-slate-500 dark:text-slate-400 md:text-[15px]">
                {description}
              </p>
            ) : null}
          </div>
          {action ? <div className="flex shrink-0 items-center gap-3">{action}</div> : null}
        </div>
      </header>

      <div className="min-h-0 flex-1">{children}</div>
    </div>
  );
}

export function DashboardSection({
  title,
  description,
  action,
  children,
  className,
  contentClassName,
}: DashboardSectionProps) {
  return (
    <section
      className={cn(
        "rounded-[28px] border border-white/60 bg-white/72 shadow-[0_20px_60px_-40px_rgba(15,23,42,0.45)] backdrop-blur-xl dark:border-slate-800/70 dark:bg-slate-950/45",
        className
      )}
    >
      {title || description || action ? (
        <div className="flex flex-col gap-3 border-b border-slate-200/70 px-5 py-4 dark:border-slate-800/80 md:flex-row md:items-start md:justify-between md:px-6">
          <div className="min-w-0">
            {title ? (
              <h2 className="text-lg font-black tracking-tight text-slate-900 dark:text-white">
                {title}
              </h2>
            ) : null}
            {description ? (
              <p className="mt-1 text-sm text-slate-500 dark:text-slate-400">{description}</p>
            ) : null}
          </div>
          {action ? <div className="shrink-0">{action}</div> : null}
        </div>
      ) : null}
      <div className={cn("p-5 md:p-6", contentClassName)}>{children}</div>
    </section>
  );
}

export function DashboardEmptyState({
  title,
  description,
  icon,
  className,
}: DashboardEmptyStateProps) {
  return (
    <div
      className={cn(
        "flex flex-col items-center justify-center rounded-[28px] border border-dashed border-slate-300/70 bg-white/55 px-6 py-12 text-center dark:border-slate-700/70 dark:bg-slate-950/30",
        className
      )}
    >
      {icon ? (
        <div className="mb-4 flex h-12 w-12 items-center justify-center rounded-2xl bg-slate-100 text-slate-500 dark:bg-slate-900 dark:text-slate-400">
          {icon}
        </div>
      ) : null}
      <h3 className="text-base font-black text-slate-900 dark:text-white">{title}</h3>
      <p className="mt-2 max-w-md text-sm leading-6 text-slate-500 dark:text-slate-400">{description}</p>
    </div>
  );
}
