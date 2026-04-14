import { redirect } from "next/navigation";
import TeamClient from "./TeamClient";
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
      <div className="flex flex-col gap-2">
        <h1 className="text-2xl font-medium tracking-tight">Team</h1>
        <p className="text-sm max-w-2xl" style={{ color: "var(--text-dim)" }}>
          Invite teammates and assign roles. Owners manage billing; admins manage keys + members;
          members consume the API; billing-only users see invoices without access to data.
        </p>
      </div>
      <TeamClient
        initialMembers={members}
        planId={overview.workspace.plan}
        seatLimit={plan.seats}
        currentUserId={session.user.id}
      />
    </div>
  );
}
