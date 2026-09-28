import { NextResponse } from "next/server";
import { getSessionUser } from "@/lib/session";

export interface AdminSession {
    id: number;
    role: string;
    name: string;
}

export async function requireAdminSession(): Promise<AdminSession | NextResponse> {
    const sessionUser = await getSessionUser();
    if (!sessionUser || sessionUser.role !== "admin") {
        return NextResponse.json({ error: "Yetkisiz erisim." }, { status: 401 });
    }

    return sessionUser;
}
