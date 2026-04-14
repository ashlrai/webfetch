# Security Policy

## Supported versions

Only the **latest published release** of each `@webfetch/*` npm package is supported with security fixes. Older versions are not patched — please upgrade.

| Package              | Supported |
| -------------------- | --------- |
| `@webfetch/core`     | latest    |
| `@webfetch/cli`      | latest    |
| `@webfetch/mcp`      | latest    |
| `@webfetch/server`   | latest    |
| previous minors      | no        |

## Reporting a vulnerability

**Please do not open a public GitHub issue for security reports.**

Report privately via either:

1. **Email:** [security@webfetch.dev](mailto:security@webfetch.dev) (PGP key on request)
2. **GitHub Security Advisory:** use the "Report a vulnerability" button under the [Security tab](https://github.com/ashlr-ai/webfetch/security/advisories/new) of this repo.

Please include:

- Affected package + version (`npm ls @webfetch/core` etc.)
- Reproduction steps or PoC
- Impact assessment (what an attacker can do)
- Any suggested remediation

We aim to acknowledge reports within **3 business days** and provide an initial assessment within **7 days**.

## Disclosure policy

We follow **coordinated disclosure** with a target of **90 days** from initial report to public advisory. Concretely:

1. Acknowledge and triage (within 3 business days).
2. Confirm and develop a fix in a private branch.
3. Publish a patched release on npm.
4. Publish a GitHub Security Advisory crediting the reporter (unless they opt out).
5. If a fix is not feasible within 90 days, we will coordinate an extended timeline with the reporter before any public disclosure.

We will request CVEs for confirmed vulnerabilities of moderate severity or higher.

## Scope

**In scope**

- All packages published under the `@webfetch/*` npm scope.
- The hosted webfetch cloud API (`api.webfetch.dev`).
- The official Chrome / VS Code extensions in this repository.
- Default-enabled provider adapters as shipped.

**Out of scope**

- User-configured custom providers (third-party bring-your-own integrations).
- Self-hosted deployments where the operator has modified default safety settings (e.g. disabled `licensePolicy: safe-only`, removed host blocklist, enabled non-default opt-in providers).
- Vulnerabilities in upstream provider APIs (Wikimedia, Unsplash, etc.) — please report those to the upstream.
- Denial of service against your own machine via misconfiguration (e.g. setting `--limit 1000000`).
- Issues that require physical access to the user's machine or pre-existing root.
- Best-practice / hardening suggestions without a demonstrable impact (please open a regular issue or discussion).

## Safe-harbor

We will not pursue legal action against researchers who:

- Make a good-faith effort to avoid privacy violations, data destruction, and service disruption.
- Report promptly and give us a reasonable window to remediate before disclosure.
- Do not access more data than necessary to demonstrate the vulnerability.

Thank you for helping keep webfetch and its users safe.
