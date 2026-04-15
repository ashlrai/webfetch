import type { Metadata } from "next";
import { buildBreadcrumbJsonLd } from "@/lib/breadcrumbs";

export const metadata: Metadata = {
  title: "Terms of Service",
  alternates: { canonical: "/legal/terms" },
};

const BREADCRUMB = buildBreadcrumbJsonLd([
  { name: "Legal", path: "/legal/terms" },
  { name: "Terms of Service", path: "/legal/terms" },
]);

export default function TermsPage() {
  return (
    <article className="max-w-3xl mx-auto px-6 py-20 prose-wf">
      <script
        type="application/ld+json"
        // biome-ignore lint/security/noDangerouslySetInnerHtml: trusted
        dangerouslySetInnerHTML={{ __html: JSON.stringify(BREADCRUMB) }}
      />
      <h1>Terms of Service</h1>
      <p>
        <em>Last updated: April 13, 2026.</em>
      </p>

      <h2>1. Agreement</h2>
      <p>
        By using getwebfetch.com, api.getwebfetch.com, or any @webfetch/* package, you agree to
        these terms. If you disagree, do not use the service.
      </p>

      <h2>2. The service</h2>
      <p>
        webfetch is a federated image search and fetching layer. The open-source packages are
        licensed under MIT (see the LICENSE file in each package). The hosted cloud service at
        api.getwebfetch.com is a paid-usage managed offering with metered fetches.
      </p>

      <h2>3. Your content and compliance</h2>
      <p>
        webfetch surfaces images from third-party sources. You are responsible for complying with
        each source's license and terms. webfetch provides license-first ranking, attribution
        strings, and sidecar metadata as compliance tools — not as legal advice.
      </p>

      <h2>4. Browser-sourced images</h2>
      <p>
        Images retrieved via the opt-in browser fallback come with <code>license: UNKNOWN</code> and
        a sidecar containing the source URL. You are solely responsible for determining whether your
        use is lawful. Ashlar AI provides no warranty on copyright clearance for browser-sourced
        images. Enterprise customers may purchase legal indemnification as a separate rider.
      </p>

      <h2>5. Billing and refunds</h2>
      <p>
        Paid tiers are billed monthly or annually via Stripe. Overage fees are metered per fetch and
        invoiced at the end of each cycle. Refunds are prorated at our discretion.
      </p>

      <h2>6. Acceptable use</h2>
      <p>
        You may not use webfetch to violate applicable law, circumvent access controls, or mass
        scrape sites in violation of their terms of service. Abuse results in account termination
        without refund.
      </p>

      <h2>7. Disclaimers</h2>
      <p>
        The service is provided "as is" without warranty of any kind. Ashlar AI is not liable for
        indirect or consequential damages.
      </p>

      <h2>8. Changes</h2>
      <p>We may update these terms with at least 30 days' notice to active customers.</p>

      <h2>Contact</h2>
      <p>legal@getwebfetch.com</p>
    </article>
  );
}
