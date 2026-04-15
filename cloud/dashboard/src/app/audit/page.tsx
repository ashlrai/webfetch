import PageHeader from "@/components/PageHeader";
import { getAudit, getUsageRows } from "@/lib/api";
import { getServerSession } from "@/lib/auth";
import { redirect } from "next/navigation";
import AuditClient from "./AuditClient";

export const dynamic = "force-dynamic";

export default async function AuditPage() {
  const session = await getServerSession();
  if (!session) redirect("/login");

  const [audit, usage] = await Promise.all([getAudit(200), getUsageRows(200)]);

  return (
    <div className="flex flex-col gap-6">
      <PageHeader
        title="Audit log"
        description="Every API call, admin action, and billing event. Useful for SOC2, invoicing reconciliation, and incident review."
      />
      <AuditClient audit={audit} usage={usage} />
    </div>
  );
}
