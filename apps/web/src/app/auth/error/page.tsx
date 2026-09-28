import { redirect } from "next/navigation";
import { auth } from "@/lib/auth";

const KNOWN_AUTH_ERRORS = new Set([
    "AccessDenied",
    "Configuration",
    "OAuthAccountNotLinked",
    "OAuthCallbackError",
]);

export default async function AuthErrorPage({
    searchParams,
}: {
    searchParams: Promise<{ error?: string }>;
}) {
    const session = await auth();
    const { error } = await searchParams;
    const safeError = error && KNOWN_AUTH_ERRORS.has(error) ? error : "OAuthCallbackError";
    const destination = session?.user?.id
        ? `/dashboard?tab=settings&error=${safeError}`
        : `/login?error=${safeError}`;
    redirect(destination);
}
