import PageHeader from "@/components/PageHeader";
import { getServerSession } from "@/lib/auth";
import { redirect } from "next/navigation";
import SettingsClient from "./SettingsClient";

export const dynamic = "force-dynamic";

export default async function SettingsPage() {
  const session = await getServerSession();
  if (!session) redirect("/login");

  return (
    <div className="flex flex-col gap-6">
      <PageHeader
        title="Settings"
        description="Profile, authentication, notifications, sessions."
      />
      <SettingsClient user={session.user} />
    </div>
  );
}
