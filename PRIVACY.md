# Privacy Policy

Last updated: 2026-04-13

This document describes, in plain developer-facing language, what data the
webfetch project collects, where it goes, how long it is kept, and how you
can remove it. Telemetry specifics live in `docs/TELEMETRY.md`; this file
is the overall policy.

## Summary

- **OSS CLI / core library**: collects nothing unless you opt in. When
  opted in, sends a small anonymous event stream. No PII.
- **Cloud service (optional, paid)**: collects what is required to run the
  service — your account profile, API keys you create, metered usage rows
  per request. Optional anonymous product analytics if you opt in.
- **We do not sell your data.**
- **We do not share your data** with third parties except vendors strictly
  needed to deliver the service (listed below).

## What the OSS software collects

Nothing, by default. If you run `webfetch telemetry enable` or set
`WEBFETCH_TELEMETRY=1`, the client sends anonymous events (event name,
anonymized install hash, product version, OS platform family) to a public
Plausible endpoint. See `docs/TELEMETRY.md` for fields and scrubbing rules.

Environment signals that disable telemetry regardless of config:
`DO_NOT_TRACK=1`, `GLOBAL_PRIVACY_CONTROL=1`, `WEBFETCH_TELEMETRY=0`.

## What the Cloud service collects

If you create an account on the hosted service:

- **Account profile**: email, display name, authentication identifiers
  from your chosen OAuth provider.
- **API keys**: you create these; we store hashes plus a prefix for
  display. Raw keys are shown once, at creation, and never again.
- **Team memberships**: team id, role, invite status.
- **Billing**: Stripe customer id, subscription state, plan tier. Card
  details are held by Stripe, never by us.
- **Usage records**: one row per API call, with timestamp, endpoint,
  response size bucket, status class, and provider id. Used for
  quota/metering and shown to you in the dashboard.

### Error tracking

When `SENTRY_DSN` is configured on the workers, exceptions are reported to
Sentry with method and path only. Authorization, cookie, and API key
headers are redacted. Request bodies are not captured unless
`SENTRY_CAPTURE_BODIES=1` is explicitly set (staging only).

### Product analytics (opt-in)

In your dashboard Settings you can opt in to PostHog analytics. It is off
by default and refuses to turn on if your browser signals DNT or Global
Privacy Control. Events are limited to the allow-list in
`docs/TELEMETRY.md`.

## What we do not collect

- We do not collect IP addresses into our analytics. Edge ingress logs
  contain IPs transiently for abuse prevention and are rotated within 14
  days.
- We do not read the contents of images you fetch.
- We do not store full URLs you query against third-party providers; we
  store provider id and response status only.
- We do not fingerprint your browser.

## What we share

We use a small set of sub-processors strictly needed to run the service:

- **Cloudflare** — edge compute, DNS, DDoS protection.
- **Stripe** — payment processing.
- **Sentry** (optional, operator-configured) — exception tracking.
- **PostHog** (opt-in) — product analytics.

We do not sell data. We do not share data with advertisers.

## Data retention

- Usage rows: 13 months, then aggregated and deleted.
- Error events: 90 days.
- Analytics events: 12 months.
- Edge access logs: 14 days.
- Account records: retained while the account is active; deleted within
  30 days of account deletion, except where retention is legally required
  (e.g. invoice records kept 7 years per accounting rules).

## Your rights (GDPR / CCPA / similar)

You may at any time:

- Export your data (Dashboard -> Settings -> Export).
- Delete your account (Dashboard -> Settings -> Delete Account). This
  triggers a 30-day purge across all primary stores and sub-processors.
- Opt out of analytics (Dashboard -> Settings -> Privacy).
- Request a copy of what we hold, correction of inaccurate data, or
  restriction of processing, by emailing `privacy@webfetch.dev`.

California residents: we do not sell or share personal information for
cross-context behavioral advertising. You have the same export and
deletion rights described above.

EU/UK residents: the lawful basis for processing is contract performance
for service data, and consent for optional analytics.

## Children

The service is not directed at children under 16. If you believe a child
has created an account, email `privacy@webfetch.dev` and we will delete it.

## Security

Data in transit uses TLS 1.2+. API keys are stored as salted hashes.
Secrets and customer data are encrypted at rest by the underlying
providers. See `SECURITY.md` for disclosure procedure.

## Changes

Material changes to this policy are announced via the dashboard banner and
the changelog at least 14 days before taking effect.

## Contact

`privacy@webfetch.dev`
