import { redirect } from "next/navigation";
import KeysClient from "./KeysClient";
import { getServerSession } from "@/lib/auth";
import { listKeys } from "@/lib/api";

export const dynamic = "force-dynamic";

export default async function KeysPage() {
  const session = await getServerSession();
  if (!session) redirect("/login");
  const initial = await listKeys();
  return (
    <div className="flex flex-col gap-6">
      <div className="flex flex-col gap-2">
        <h1 className="text-2xl font-medium tracking-tight">API keys</h1>
        <p className="text-sm max-w-2xl" style={{ color: "var(--text-dim)" }}>
          Keys authenticate requests to <span className="mono">api.webfetch.dev</span>. Each key is
          scoped to this workspace. Rotate or revoke instantly — we never display the secret
          after creation.
        </p>
      </div>
      <KeysClient initial={initial} />
    </div>
  );
}
