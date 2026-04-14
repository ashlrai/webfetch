import { redirect } from "next/navigation";
import SettingsClient from "./SettingsClient";
import { getServerSession } from "@/lib/auth";

export const dynamic = "force-dynamic";

export default async function SettingsPage() {
  const session = await getServerSession();
  if (!session) redirect("/login");

  return (
    <div className="flex flex-col gap-6">
      <div className="flex flex-col gap-2">
        <h1 className="text-2xl font-medium tracking-tight">Settings</h1>
        <p className="text-sm max-w-2xl" style={{ color: "var(--text-dim)" }}>
          Profile, authentication, and notification preferences.
        </p>
      </div>
      <SettingsClient user={session.user} />
    </div>
  );
}
