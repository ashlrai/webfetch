import { redirect } from "next/navigation";
import KeysClient from "./KeysClient";
import PageHeader from "@/components/PageHeader";
import { getServerSession } from "@/lib/auth";
import { listKeys } from "@/lib/api";

export const dynamic = "force-dynamic";

export default async function KeysPage() {
  const session = await getServerSession();
  if (!session) redirect("/login");
  const initial = await listKeys();

  return (
    <div className="flex flex-col gap-6">
      <PageHeader
        title="API keys"
        description="Keys authenticate requests to api.getwebfetch.com. Scoped per workspace. The secret is shown once at creation — rotate or revoke anytime."
      />
      <KeysClient initial={initial} />
    </div>
  );
}
