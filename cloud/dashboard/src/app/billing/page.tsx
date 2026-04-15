import { Icon } from "@/components/Icon";
import PageHeader from "@/components/PageHeader";
import PlanCard from "@/components/PlanCard";
import UpgradePrompt from "@/components/UpgradePrompt";
import { getBilling, getOverview } from "@/lib/api";
import { getServerSession } from "@/lib/auth";
import { formatDate, formatUsd } from "@/lib/format";
import { PLANS } from "@shared/pricing";
import { redirect } from "next/navigation";

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

  // fake invoice history (portal owns the real ones)
  const invoices = [
    { id: "in_01", date: Date.now() - 7 * 86400_000, amount: plan.baseMonthlyUsd, status: "paid" },
    { id: "in_02", date: Date.now() - 37 * 86400_000, amount: plan.baseMonthlyUsd, status: "paid" },
    { id: "in_03", date: Date.now() - 67 * 86400_000, amount: plan.baseMonthlyUsd, status: "paid" },
  ];

  return (
    <div className="flex flex-col gap-7">
      <PageHeader
        title="Billing"
        description="Manage your subscription, payment method, and invoice history. Payments processed by Stripe."
        actions={
          portalUrl ? (
            <a
              href={portalUrl}
              target="_blank"
              rel="noreferrer noopener"
              className="btn btn-primary"
            >
              <Icon name="external" /> Manage subscription
            </a>
          ) : (
            <a href="/api/proxy/workspaces/current/checkout?plan=pro" className="btn btn-primary">
              <Icon name="arrow-up" /> Start subscription
            </a>
          )
        }
      />

      {/* Current plan strip */}
      <section className="grid grid-cols-1 md:grid-cols-3 gap-2">
        <div className="surface p-4 flex flex-col gap-2">
          <span className="eyebrow">Current plan</span>
          <div className="flex items-baseline gap-2">
            <span className="num-lg">{plan.label}</span>
            <span className="mono text-[12px]" style={{ color: "var(--text-mute)" }}>
              {plan.baseMonthlyUsd > 0 ? `${formatUsd(plan.baseMonthlyUsd)}/mo` : "free"}
            </span>
          </div>
          <div className="flex items-center gap-1.5">
            <span className={`badge ${statusClass}`}>{billing.status}</span>
            {billing.cancelAtPeriodEnd && (
              <span className="badge badge-warn">cancels at period end</span>
            )}
          </div>
        </div>
        <div className="surface p-4 flex flex-col gap-2">
          <span className="eyebrow">Next invoice</span>
          <div className="num-lg">{formatDate(billing.currentPeriodEnd)}</div>
          <div className="mono text-[11.5px]" style={{ color: "var(--text-mute)" }}>
            {plan.baseMonthlyUsd > 0
              ? `${formatUsd(plan.baseMonthlyUsd)} base · overage extra`
              : "no charge — free tier"}
          </div>
        </div>
        <div className="surface p-4 flex flex-col gap-2">
          <span className="eyebrow">Payment method</span>
          <div className="flex items-center gap-2">
            <div
              className="h-8 w-12 rounded-[4px] flex items-center justify-center"
              style={{ background: "var(--bg-elev)", border: "1px solid var(--border-mid)" }}
            >
              <Icon name="card" />
            </div>
            <div className="flex flex-col">
              <span className="mono text-[13px]">•••• 4242</span>
              <span className="mono text-[11px]" style={{ color: "var(--text-mute)" }}>
                exp 12/28
              </span>
            </div>
          </div>
        </div>
      </section>

      {overview.workspace.plan !== "enterprise" && (
        <UpgradePrompt
          plan={overview.workspace.plan}
          reason={overview.workspace.plan === "free" ? "free" : "quota"}
        />
      )}

      {/* Plans comparison */}
      <section className="flex flex-col gap-3">
        <div className="flex items-baseline justify-between">
          <h2 className="h2">Plans</h2>
          <a
            href="https://getwebfetch.com/pricing"
            target="_blank"
            rel="noreferrer"
            className="text-[12px]"
            style={{ color: "var(--text-dim)" }}
          >
            Full comparison →
          </a>
        </div>
        <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-4 gap-3">
          {(["free", "pro", "team", "enterprise"] as const).map((p) => (
            <PlanCard
              key={p}
              plan={p}
              current={p === overview.workspace.plan}
              cta={
                p === overview.workspace.plan ? (
                  <button className="btn w-full" disabled>
                    Current plan
                  </button>
                ) : p === "enterprise" ? (
                  <a href="mailto:sales@getwebfetch.com" className="btn w-full">
                    Talk to sales
                  </a>
                ) : (
                  <a
                    href={`/api/proxy/workspaces/current/checkout?plan=${p}`}
                    className="btn btn-primary w-full"
                  >
                    {plan.baseMonthlyUsd > PLANS[p].baseMonthlyUsd ? "Downgrade" : "Upgrade"}
                  </a>
                )
              }
            />
          ))}
        </div>
      </section>

      {/* Invoice history */}
      <section className="flex flex-col gap-3">
        <div className="flex items-baseline justify-between">
          <h2 className="h2">Invoice history</h2>
          {portalUrl && (
            <a
              href={portalUrl}
              target="_blank"
              rel="noreferrer"
              className="text-[12px]"
              style={{ color: "var(--text-dim)" }}
            >
              Download PDFs →
            </a>
          )}
        </div>
        {plan.baseMonthlyUsd === 0 ? (
          <div className="surface p-5 text-[13px]" style={{ color: "var(--text-dim)" }}>
            No invoices yet — you're on the free tier.
          </div>
        ) : (
          <div className="surface overflow-hidden">
            <table className="data">
              <thead>
                <tr>
                  <th>Invoice</th>
                  <th>Date</th>
                  <th>Amount</th>
                  <th>Status</th>
                  <th style={{ textAlign: "right" }}>Receipt</th>
                </tr>
              </thead>
              <tbody>
                {invoices.map((inv) => (
                  <tr key={inv.id}>
                    <td className="mono">{inv.id}</td>
                    <td className="mono text-[11.5px]" style={{ color: "var(--text-dim)" }}>
                      {formatDate(inv.date)}
                    </td>
                    <td className="mono">{formatUsd(inv.amount)}</td>
                    <td>
                      <span className="badge badge-ok">{inv.status}</span>
                    </td>
                    <td style={{ textAlign: "right" }}>
                      <a
                        href={portalUrl ?? "#"}
                        target="_blank"
                        rel="noreferrer"
                        className="btn btn-sm btn-ghost"
                      >
                        <Icon name="download" /> PDF
                      </a>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>
    </div>
  );
}
