import type { Metadata } from "next";
import { buildBreadcrumbJsonLd } from "@/lib/breadcrumbs";

export const metadata: Metadata = {
  title: "License Policy",
  alternates: { canonical: "/legal/license-policy" },
};

const BREADCRUMB = buildBreadcrumbJsonLd([
  { name: "Legal", path: "/legal/license-policy" },
  { name: "License Policy", path: "/legal/license-policy" },
]);

export default function LicensePolicyPage() {
  return (
    <article className="max-w-3xl mx-auto px-6 py-20 prose-wf">
      <script
        type="application/ld+json"
        // biome-ignore lint/security/noDangerouslySetInnerHtml: trusted
        dangerouslySetInnerHTML={{ __html: JSON.stringify(BREADCRUMB) }}
      />
      <h1>License Policy</h1>
      <p>
        webfetch's ranker sorts candidates <strong>license-first</strong>. The rest follows.
      </p>

      <h2>Ranking (lower = preferred)</h2>
      <table>
        <thead>
          <tr>
            <th>#</th>
            <th>Tag</th>
            <th>Meaning</th>
          </tr>
        </thead>
        <tbody>
          <tr>
            <td>1</td>
            <td>
              <code>CC0</code>
            </td>
            <td>Public-domain dedication; no attribution needed</td>
          </tr>
          <tr>
            <td>2</td>
            <td>
              <code>PUBLIC_DOMAIN</code>
            </td>
            <td>Expired copyright or government work</td>
          </tr>
          <tr>
            <td>3</td>
            <td>
              <code>CC_BY</code>
            </td>
            <td>Commercial OK, attribution required</td>
          </tr>
          <tr>
            <td>4</td>
            <td>
              <code>CC_BY_SA</code>
            </td>
            <td>Commercial OK, attribution + sharealike</td>
          </tr>
          <tr>
            <td>5</td>
            <td>
              <code>EDITORIAL_LICENSED</code>
            </td>
            <td>Platform ToS allows editorial display (Spotify, CAA, iTunes)</td>
          </tr>
          <tr>
            <td>6</td>
            <td>
              <code>PRESS_KIT_ALLOWLIST</code>
            </td>
            <td>Official press kit from an allowlisted URL</td>
          </tr>
          <tr>
            <td>99</td>
            <td>
              <code>UNKNOWN</code>
            </td>
            <td>
              <strong>REJECTED</strong> by default
            </td>
          </tr>
        </tbody>
      </table>

      <h2>Why license-first, not relevance-first</h2>
      <p>
        The only outcome we refuse is shipping an image we can't justify. A marginally-better photo
        under an unknown license is worthless to a pipeline that needs to ship without human review.
        Relevance ties are easy to break; provenance is not. When you want relevance-first, you're
        usually in a speculative exploration flow — use <code>licensePolicy: "prefer-safe"</code> to
        keep unsafe results but push them to the back.
      </p>

      <h2>Why UNKNOWN is rejected</h2>
      <p>
        A missing license is not "probably fine". Most of the web is all-rights-reserved by default
        under the Berne Convention. If we guessed "safe" we'd ship infringing images. Better: we
        surface structured coverage gaps so the caller can make an explicit call — pay for a press
        photo, email the photographer, or drop the feature.
      </p>

      <h2>Attribution</h2>
      <p>
        <code>buildAttribution()</code> produces a single human-readable string, kept as a string
        rather than structured markup so callers can render it inline in a tooltip, a footer, or a
        dedicated credits page.
      </p>
      <blockquote>
        "Drake at OVO Fest 2019" by Jane Photog (Wikimedia Commons), licensed CC BY-SA 4.0
      </blockquote>

      <h2>Confidence score</h2>
      <p>
        Each candidate carries a <code>confidence</code> in [0, 1]:
      </p>
      <ul>
        <li>
          <strong>0.95</strong> — structured license metadata from an authoritative API
        </li>
        <li>
          <strong>0.85</strong> — platform-owned license (Unsplash, Pexels, Pixabay)
        </li>
        <li>
          <strong>0.6–0.8</strong> — heuristics + coercion
        </li>
        <li>
          <strong>≤ 0.4</strong> — host-based guess only
        </li>
        <li>
          <strong>0</strong> — no evidence
        </li>
      </ul>
      <p>
        Any candidate with <code>confidence &lt; 0.5</code> should be re-verified before shipping
        even if its tag is "safe".
      </p>

      <h2>Browser-sourced images</h2>
      <p>
        Images retrieved via the opt-in browser fallback are always tagged <code>UNKNOWN</code>,
        carry a source-URL sidecar, and require an explicit per-call opt-in flag. We do not attempt
        to classify their license; that is the caller's responsibility.
      </p>
    </article>
  );
}
