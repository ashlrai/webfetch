import { Icon } from "@/components/Icon";
import PageHeader from "@/components/PageHeader";
import ProviderRow from "@/components/ProviderRow";
import { getProviders } from "@/lib/api";
import { getServerSession } from "@/lib/auth";
import { redirect } from "next/navigation";

export const dynamic = "force-dynamic";

export default async function ProvidersPage() {
  const session = await getServerSession();
  if (!session) redirect("/login");

  const providers = await getProviders();
  const byok = providers.filter((p) => p.mode === "byok").length;
  const pool = providers.filter((p) => p.mode === "pool").length;
  const missing = providers.filter((p) => p.mode === "missing").length;

  return (
    <div className="flex flex-col gap-6">
      <PageHeader
        title="Providers"
        description="Bring your own keys or use webfetch's pooled quota (included on Pro+). Keys are encrypted at rest and only decrypted inside the Worker runtime."
      />

      <div className="flex items-center gap-2 flex-wrap">
        <span className="badge badge-ok">
          <Icon name="check" size={10} /> {byok} your keys
        </span>
        <span className="badge badge-info">{pool} pool</span>
        <span className="badge badge-warn">{missing} missing</span>
        <span style={{ color: "var(--text-mute)" }} className="mono text-[11px] ml-1">
          {providers.length} total
        </span>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-3">
        {providers.map((p) => (
          <ProviderRow key={p.name} provider={p} />
        ))}
      </div>
    </div>
  );
}
