import type { Metadata } from "next";

export const metadata: Metadata = { title: "Privacy Policy" };

export default function PrivacyPage() {
  return (
    <article className="max-w-3xl mx-auto px-6 py-20 prose-wf">
      <h1>Privacy Policy</h1>
      <p><em>Last updated: April 13, 2026.</em></p>

      <h2>What we collect</h2>
      <ul>
        <li>Account info: email, OAuth identifier (if you sign in with Google/GitHub).</li>
        <li>Usage metadata: API calls, timestamps, query strings, chosen providers, billing counters.</li>
        <li>Billing info: handled by Stripe; we store the customer ID and last four digits only.</li>
      </ul>

      <h2>What we do not collect</h2>
      <ul>
        <li>We do not mine your search queries for ML training.</li>
        <li>We do not sell data to third parties.</li>
        <li>We do not store image bytes beyond the shared SHA-256 cache (60-day TTL).</li>
      </ul>

      <h2>Self-hosted use</h2>
      <p>
        If you use the open-source CLI, MCP, or server packages without a cloud account, zero
        telemetry leaves your machine.
      </p>

      <h2>Data retention</h2>
      <p>
        Request logs are retained 30 days on Free and Pro, 90 days on Team, 1 year on Enterprise.
        You can export or delete your data at any time via the dashboard.
      </p>

      <h2>Subprocessors</h2>
      <ul>
        <li>Cloudflare (infrastructure)</li>
        <li>Stripe (billing)</li>
        <li>Better Auth (self-hosted) + Resend (transactional email)</li>
        <li>Bright Data (managed browser fallback — only for Pro+ browser calls)</li>
      </ul>

      <h2>Contact</h2>
      <p>privacy@getwebfetch.com</p>
    </article>
  );
}
