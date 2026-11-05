import type { ReactNode } from "react";

// The stream screen's route group. Its <html> and <body> come from the site's root layout,
// which answers /stream/* with a bare document (no providers, banners or toasts). The group
// becomes a root layout of its own only once every other route moves into a group too.
export default function StreamLayout({ children }: { children: ReactNode }) {
    return children;
}
