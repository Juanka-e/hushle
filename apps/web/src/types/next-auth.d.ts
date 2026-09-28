import { DefaultSession } from "next-auth";
import "next-auth/jwt";

declare module "next-auth" {
    interface User {
        id: string;
        role?: string;
        sessionVersion?: number;
    }

    interface Session {
        user: DefaultSession["user"] & {
            id: string;
            role?: string;
            sessionVersion?: number;
        };
    }
}

declare module "next-auth/jwt" {
    interface JWT {
        role?: string;
        sessionVersion?: number;
    }
}
