# Telemetry

webfetch ships telemetry **OFF by default**. Nothing about your usage leaves
your machine unless you explicitly opt in. This document explains what
exists, how to turn it on or off, and exactly what is collected when you do.

## TL;DR

- OSS CLI / core library: opt-in, anonymous event pings. Off unless enabled.
- Cloud workers: Sentry error tracking, gated on `SENTRY_DSN`. Off unless the
  operator configures it. No request bodies or PII.
- Dashboard: PostHog product analytics, opt-in per user in Settings. Honors
  DNT and Global Privacy Control.

## OSS CLI and core library

### Enable or disable

Any one of the following turns it on:

- `webfetch telemetry enable`
- `WEBFETCH_TELEMETRY=1`
- Add `"telemetry": true` to `~/.webfetch/config.json`
- Pass `--telemetry` to a CLI invocation

Any one of the following forces it off, overriding the above:

- `webfetch telemetry disable`
- `WEBFETCH_TELEMETRY=0`
- `DO_NOT_TRACK=1`
- `GLOBAL_PRIVACY_CONTROL=1`
- `--no-telemetry`

Status: `webfetch telemetry status`.

### First-run prompt

The first time you run the CLI interactively, you are asked:

> Optional: share anonymous usage to help prioritize providers? [y/N]

Default is no. Set `WEBFETCH_NO_FIRST_RUN_PROMPT=1` to skip the prompt. The
prompt is skipped automatically in CI (`CI=1` or `CI=true`) and in
non-interactive shells.

### What is collected

When enabled, each event is a JSON document with:

- `name` — one of: `cli_invoked`, `search_completed`, `fetch_completed`,
  `provider_error`, `telemetry_enabled`, `telemetry_disabled`
- `install` — first 16 hex chars of
  `sha256("webfetch.telemetry.v1:" + hostname)`. Not reversible to your
  hostname.
- `version` — the webfetch version string.
- `os` — one of `darwin`, `linux`, `win32`, `other`.
- Low-cardinality props (e.g. provider id, result count bucket).

### What is never collected

- IP addresses (payload contains none; the public endpoint discards them).
- User agents.
- File paths, URLs, query strings, tokens, emails, API keys, or the
  contents of any image or metadata.
- Values longer than 128 characters. Values matching `@`, `http(s)://`, or a
  path separator are dropped before send.

### Where it goes

Default endpoint is a public Plausible instance
(`https://plausible.io/api/event`). If that fails, the client retries once
against `https://telemetry.webfetch.workers.dev/event`. Both endpoints
discard IP and User-Agent on ingest.

### Disabling permanently

`webfetch telemetry disable` writes `"telemetry": false` to
`~/.webfetch/config.json`. You can also delete the file. The env var
`WEBFETCH_TELEMETRY=0` overrides any config and can be set globally.

## Cloud workers (error tracking)

Error tracking uses `@sentry/cloudflare`. It is **no-op** unless the worker
environment has `SENTRY_DSN` set.

### What is captured

- Exceptions thrown in Hono middleware, Stripe webhook handlers, and queue
  consumers.
- Minimal request context: method and path. No body, no query string
  values, no cookies.

### Scrubbing

- `Authorization`, `Cookie`, `Set-Cookie`, `x-api-key`, `x-auth-token`, and
  `Proxy-Authorization` headers are replaced with `[REDACTED]`.
- Any JSON key matching `api_key`, `apikey`, `secret`, `token`, `password`,
  `bearer`, `authorization`, `session`, `cookie`, or `ssn` is replaced
  with `[REDACTED]`.
- Strings containing `Bearer <token>` have the token stripped inline.
- `user` and `server_name` fields are removed from every event.

### Request bodies

Off by default. Set `SENTRY_CAPTURE_BODIES=1` on the worker to capture
bodies (still passed through the scrubber). Intended for staging only.

## Dashboard analytics

Uses PostHog (`posthog-js`). Opt-in per user. Consent is stored both in
`localStorage` (key: `webfetch.analytics.consent`) and mirrored to the user
profile server-side.

### Events

- `sign_up`
- `create_api_key`
- `first_fetch`
- `upgrade_initiated`
- `upgrade_completed`
- `team_invite_sent`

Unknown events are dropped at the wrapper.

### Privacy hints

If `navigator.doNotTrack === "1"` or `navigator.globalPrivacyControl === true`,
analytics is hard-off and the consent toggle refuses to enable it.

### PostHog configuration

- `autocapture: false`
- `capture_pageview: false`
- `disable_session_recording: true`
- `mask_all_text: true`
- `mask_all_element_attributes: true`
- `ip: false`
- `respect_dnt: true`

## Questions

Email `privacy@webfetch.dev`. See also `PRIVACY.md` at the repository root.
