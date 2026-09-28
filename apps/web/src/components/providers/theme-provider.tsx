"use client";

import { ThemeProvider as NextThemesProvider } from "next-themes";
import { type ReactNode } from "react";

interface ThemeProviderProps {
    children: ReactNode;
    nonce?: string;
}

export function ThemeProvider({ children, nonce }: ThemeProviderProps) {
    return (
        <NextThemesProvider
            attribute="class"
            defaultTheme="dark"
            enableSystem
            disableTransitionOnChange
            nonce={nonce}
        >
            {children}
        </NextThemesProvider>
    );
}
