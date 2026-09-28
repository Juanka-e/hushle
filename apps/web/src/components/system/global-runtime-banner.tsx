interface GlobalRuntimeBannerProps {
    tone: "info" | "warning";
    message: string;
}

export function GlobalRuntimeBanner({ tone, message }: GlobalRuntimeBannerProps) {
    const className = tone === "warning"
        ? "border-amber-500/25 bg-amber-500/12 text-amber-950 dark:text-amber-100"
        : "border-blue-500/20 bg-blue-500/10 text-blue-950 dark:text-blue-100";

    return (
        <div className={`border-b px-4 py-2 text-center text-sm font-medium backdrop-blur ${className}`}>
            {message}
        </div>
    );
}
