import { redirect } from "next/navigation";
import TeamClient from "./TeamClient";
import PageHeader from "@/components/PageHeader";
import { getServerSession } from "@/lib/auth";
import { getOverview, listMembers } from "@/lib/api";
import { PLANS } from "@shared/pricing";

export const dynamic = "force-dynamic";

export default async function TeamPage() {
  const session = await getServerSession();
  if (!session) redirect("/login");

  const [overview, members] = await Promise.all([getOverview(), listMembers()]);
  const plan = PLANS[overview.workspace.plan];

  return (
    <div className="flex flex-col gap-6">
      <PageHeader
        title="Team"
        description="Invite teammates and assign roles. Owners manage billing; admins manage keys and members; members consume the API; billing-only users see invoices."
      />
      <TeamClient
        initialMembers={members}
        planId={overview.workspace.plan}
        seatLimit={plan.seats}
        currentUserId={session.user.id}
      />
    </div>
  );
}
