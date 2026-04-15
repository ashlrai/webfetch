import PageHeader from "@/components/PageHeader";
import { getOverview } from "@/lib/api";
import { getServerSession } from "@/lib/auth";
import { redirect } from "next/navigation";
import UsageClient from "./UsageClient";

export const dynamic = "force-dynamic";

export default async function UsagePage() {
  const session = await getServerSession();
  if (!session) redirect("/login");
  const overview = await getOverview();

  return (
    <div className="flex flex-col gap-6">
      <PageHeader
        title="Usage"
        description="Daily fetches, per-endpoint and per-provider breakdowns, and running cost. Export any view for invoicing or audit."
      />
      <UsageClient
        dailySeries={overview.dailySeries}
        perEndpoint={overview.perEndpoint}
        perProvider={overview.perProvider}
      />
    </div>
  );
}
