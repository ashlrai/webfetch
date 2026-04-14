import { redirect } from "next/navigation";
import UsageClient from "./UsageClient";
import { getServerSession } from "@/lib/auth";
import { getOverview } from "@/lib/api";

export const dynamic = "force-dynamic";

export default async function UsagePage() {
  const session = await getServerSession();
  if (!session) redirect("/login");

  const overview = await getOverview();

  return (
    <div className="flex flex-col gap-6">
      <div className="flex flex-col gap-2">
        <h1 className="text-2xl font-medium tracking-tight">Usage</h1>
        <p className="text-sm max-w-2xl" style={{ color: "var(--text-dim)" }}>
          Daily fetches, per-endpoint and per-provider breakdowns, and running cost. Export any
          view to CSV for invoicing or audit.
        </p>
      </div>
      <UsageClient
        dailySeries={overview.dailySeries}
        perEndpoint={overview.perEndpoint}
        perProvider={overview.perProvider}
      />
    </div>
  );
}
