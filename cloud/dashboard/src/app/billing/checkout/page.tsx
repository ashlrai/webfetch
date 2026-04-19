"use client";

import { useRouter, useSearchParams } from "next/navigation";
import { useEffect, useRef } from "react";

/**
 * Auto-triggers a Stripe Checkout session for the plan in ?plan=.
 * Users land here after signup with ?plan=pro|team (threaded from the
 * landing pricing page). Already-logged-in users clicking an upgrade CTA
 * in the billing page also hit this route.
 *
 * Flow:
 *   1. POST /api/proxy/v1/workspaces/current/checkout with { plan }
 *   2. Worker resolves "current" → session user's workspace, creates/reuses
 *      Stripe customer, returns { url }
 *   3. window.location = url  (Stripe-hosted checkout)
 *   4. On success Stripe redirects to APP_URL/billing?status=success
 */
export default function BillingCheckoutPage() {
  const params = useSearchParams();
  const router = useRouter();
  const triggered = useRef(false);

  const plan = params.get("plan");

  useEffect(() => {
    if (triggered.current) return;
    triggered.current = true;

    const validPlan = plan === "pro" || plan === "team" ? plan : null;
    if (!validPlan) {
      router.replace("/billing");
      return;
    }

    (async () => {
      try {
        const res = await fetch("/api/proxy/v1/workspaces/current/checkout", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ plan: validPlan }),
          credentials: "include",
        });
        if (res.status === 401) {
          router.replace(`/login?next=${encodeURIComponent(`/billing/checkout?plan=${validPlan}`)}`);
          return;
        }
        if (!res.ok) {
          router.replace("/billing?status=checkout_error");
          return;
        }
        const data = (await res.json()) as { url?: string };
        if (data.url) {
          window.location.href = data.url;
        } else {
          router.replace("/billing?status=checkout_error");
        }
      } catch {
        router.replace("/billing?status=checkout_error");
      }
    })();
  }, [plan, router]);

  return (
    <div className="flex flex-col items-center justify-center gap-4 py-24">
      <div
        className="size-10 rounded-full border-2 border-t-transparent animate-spin"
        style={{ borderColor: "var(--accent)", borderTopColor: "transparent" }}
      />
      <p className="text-[13px]" style={{ color: "var(--text-dim)" }}>
        Opening checkout…
      </p>
    </div>
  );
}
