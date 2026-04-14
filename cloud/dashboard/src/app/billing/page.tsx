import { redirect } from "next/navigation";
import PlanCard from "@/components/PlanCard";
import UpgradePrompt from "@/components/UpgradePrompt";
import { getServerSession } from "@/lib/auth";
import { getBilling, getOverview } from "@/lib/api";
import { formatDate, formatUsd } from "@/lib/format";
import { PLANS } from "@shared/pricing";

export const dynamic = "force-dynamic";

export default async function BillingPage() {
  const session = await getServerSession();
  if (!session) redirect("/login");

  const [overview, billing] = await Promise.all([getOverview(), getBilling()]);
  const plan = PLANS[overview.workspace.plan];

  const portalUrl = billing.stripeCustomerPortalUrl;
  const statusClass =
    billing.status === "active" || billing.status === "trialing"
      ? "badge-ok"
      : billing.status === "past_due" || billing.status === "unpaid"
        ? "badge-err"
        : "";

  return (
    <div className="flex flex-col gap-8">
      <div className="flex flex-col gap-2">
        <h1 className="text-2xl font-medium tracking-tight">Billing</h1>
        <p className="text-sm max-w-2xl" style={{ color: "var(--text-dim)" }}>
          Manage your subscription, payment method, and invoice history. All payments are
          processed by Stripe.
        </p>
      </div>

      <section className="grid grid-cols-1 md:grid-cols-3 gap-3">
        <div className="card p-4">
          <div className="text-[11px] uppercase tracking-[0.08em]" style={{ color: "var(--text-mute)" }}>
            Current plan
          </div>
          <div className="mt-1 text-2xl font-medium">{plan.label}</div>
          <div className="mt-1 flex items-center gap-2">
            <span className={`badge ${statusClass}`}>{billing.status}</span>
            {billing.cancelAtPeriodEnd && <span className="badge badge-warn">cancels at period end</span>}
          </div>
        </div>
        <div className="card p-4">
          <div className="text-[11px] uppercase tracking-[0.08em]" style={{ color: "var(--text-mute)" }}>
            Next invoice
          </div>
          <div className="mt-1 text-2xl font-medium">{formatDate(billing.currentPeriodEnd)}</div>
          <div className="text-xs mono" style={{ color: "var(--text-dim)" }}>
            {plan.baseMonthlyUsd > 0 ? `${formatUsd(plan.baseMonthlyUsd)} base` : "free tier"}
          </div>
        </div>
        <div className="card p-4 flex flex-col gap-2 justify-between">
          <div>
            <div className="text-[11px] uppercase tracking-[0.08em]" style={{ color: "var(--text-mute)" }}>
              Subscription
            </div>
            <div className="mt-1 text-sm" style={{ color: "var(--text-dim)" }}>
              Update card, download invoices, cancel — all through Stripe's Customer Portal.
            </div>
          </div>
          {portalUrl ? (
            <a href={portalUrl} target="_blank" rel="noreferrer noopener" className="btn btn-primary">
              Manage subscription
            </a>
          ) : (
            <a href="/api/proxy/v1/billing/checkout?plan=pro" className="btn btn-primary">
              Start a subscription
            </a>
          )}
        </div>
      </section>

      {overview.workspace.plan !== "enterprise" && (
        <UpgradePrompt
          plan={overview.workspace.plan}
          reason={overview.workspace.plan === "free" ? "free" : "quota"}
        />
      )}

      <section className="flex flex-col gap-3">
        <h2 className="text-sm font-medium uppercase tracking-[0.08em]" style={{ color: "var(--text-mute)" }}>
          Plans
        </h2>
        <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-4 gap-4">
          {(["free", "pro", "team", "enterprise"] as const).map((p) => (
            <PlanCard
              key={p}
              plan={p}
              current={p === overview.workspace.plan}
              cta={
                p === overview.workspace.plan ? (
                  <button className="btn" disabled>
                    Current
                  </button>
                ) : p === "enterprise" ? (
                  <a href="mailto:sales@webfetch.dev" className="btn">
                    Talk to sales
                  </a>
                ) : (
                  <a
                    href={`/api/proxy/v1/billing/checkout?plan=${p}`}
                    className="btn btn-primary"
                  >
                    {plan.baseMonthlyUsd > PLANS[p].baseMonthlyUsd ? "Downgrade" : "Upgrade"}
                  </a>
                )
              }
            />
          ))}
        </div>
      </section>

      <section className="flex flex-col gap-3">
        <h2 className="text-sm font-medium uppercase tracking-[0.08em]" style={{ color: "var(--text-mute)" }}>
          Invoice history
        </h2>
        <div className="card p-5 text-sm" style={{ color: "var(--text-dim)" }}>
          Invoice history is maintained by Stripe. Click{" "}
          <strong style={{ color: "var(--text)" }}>Manage subscription</strong> above to view and
          download PDFs for every invoice on this subscription.
        </div>
      </section>
    </div>
  );
}
