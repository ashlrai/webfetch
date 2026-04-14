import { redirect } from "next/navigation";
import AuditClient from "./AuditClient";
import { getServerSession } from "@/lib/auth";
import { getAudit, getUsageRows } from "@/lib/api";

export const dynamic = "force-dynamic";

export default async function AuditPage() {
  const session = await getServerSession();
  if (!session) redirect("/login");

  const [audit, usage] = await Promise.all([getAudit(200), getUsageRows(200)]);

  return (
    <div className="flex flex-col gap-6">
      <div className="flex flex-col gap-2">
        <h1 className="text-2xl font-medium tracking-tight">Audit log</h1>
        <p className="text-sm max-w-2xl" style={{ color: "var(--text-dim)" }}>
          Every API call, admin action, and billing event. Filter, search, and export — useful
          for SOC2, invoicing reconciliation, and incident review.
        </p>
      </div>
      <AuditClient audit={audit} usage={usage} />
    </div>
  );
}
