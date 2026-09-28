import { redirect } from "next/navigation";
import { getSessionUser } from "@/lib/session";

export default async function ProfilePage() {
  const sessionUser = await getSessionUser();
  if (!sessionUser) {
    redirect("/login?callbackUrl=/dashboard%3Ftab%3Dsettings");
  }

  redirect("/dashboard?tab=settings");
}
