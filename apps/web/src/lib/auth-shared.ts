import type { NextAuthConfig } from "next-auth";
import { shouldTrustAuthHost } from "@/lib/auth-host";

export const sharedAuthConfig = {
    providers: [],
    trustHost: shouldTrustAuthHost(),
    pages: {
        signIn: "/login",
        error: "/auth/error",
    },
    callbacks: {
        async jwt({ token, user }) {
            if (user) {
                token.sub = user.id;
                token.role = user.role;
                token.sessionVersion = user.sessionVersion;
            }
            return token;
        },
        async session({ session, token }) {
            if (session.user) {
                session.user.id = token.sub || "";
                session.user.role = (token.role as string) || "user";
                session.user.sessionVersion =
                    typeof token.sessionVersion === "number"
                        ? token.sessionVersion
                        : -1;
            }
            return session;
        },
    },
    session: {
        strategy: "jwt",
        maxAge: 24 * 60 * 60,
    },
} satisfies NextAuthConfig;
