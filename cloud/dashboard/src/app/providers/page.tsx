import { redirect } from "next/navigation";
import ProviderRow from "@/components/ProviderRow";
import { getServerSession } from "@/lib/auth";
import { getProviders } from "@/lib/api";

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
      <div className="flex flex-col gap-2">
        <h1 className="text-2xl font-medium tracking-tight">Providers</h1>
        <p className="text-sm max-w-2xl" style={{ color: "var(--text-dim)" }}>
          Bring your own API keys for any provider, or use webfetch's pooled quota (included in
          Pro+). Keys are encrypted at rest and only decrypted inside the Worker runtime that
          dispatches fetches.
        </p>
      </div>

      <div className="flex items-center gap-2 flex-wrap">
        <span className="badge badge-ok">{byok} your keys</span>
        <span className="badge badge-info">{pool} using pool</span>
        <span className="badge badge-warn">{missing} missing</span>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-3">
        {providers.map((p) => (
          <ProviderRow key={p.name} provider={p} />
        ))}
      </div>
    </div>
  );
}
