#!/usr/bin/env bash
# smoke-launch.sh — post-deploy smoke test for webfetch production.
#
# Exercises: health → provider pool → free-tier 401 → Pro search → usage metering.
# Pauses where human interaction is required (checkout, email verification).
#
# Usage:
#   TEST_EMAIL=you@example.com \
#   WEBFETCH_PRO_KEY=wf_live_xxx \
#   scripts/smoke-launch.sh
#
# Required env vars:
#   TEST_EMAIL        — real inbox you can check (for signup verification step)
#   WEBFETCH_PRO_KEY  — Pro API key (created after upgrading; paste when prompted)
#
# Optional overrides:
#   WEBFETCH_API  (default: https://api.getwebfetch.com)
#   WEBFETCH_APP  (default: https://app.getwebfetch.com)

set -euo pipefail

WEBFETCH_API="${WEBFETCH_API:-https://api.getwebfetch.com}"
WEBFETCH_APP="${WEBFETCH_APP:-https://app.getwebfetch.com}"

# ---------------------------------------------------------------------------
# Require TEST_EMAIL. WEBFETCH_PRO_KEY can be provided later when prompted.
# ---------------------------------------------------------------------------
if [[ -z "${TEST_EMAIL:-}" ]]; then
  printf "ERROR: TEST_EMAIL is required.\n" >&2
  printf "  TEST_EMAIL=you@example.com scripts/smoke-launch.sh\n" >&2
  exit 1
fi

# ---------------------------------------------------------------------------
# Color helpers (disabled when not a tty).
# ---------------------------------------------------------------------------
if [[ -t 1 ]]; then
  C_BOLD=$'\033[1m'; C_GREEN=$'\033[32m'; C_RED=$'\033[31m'
  C_YELLOW=$'\033[33m'; C_CYAN=$'\033[36m'; C_DIM=$'\033[2m'; C_RESET=$'\033[0m'
else
  C_BOLD=""; C_GREEN=""; C_RED=""; C_YELLOW=""; C_CYAN=""; C_DIM=""; C_RESET=""
fi

FAILED=0

section() {
  printf "\n%s%s== %s ==%s\n" "$C_BOLD" "$C_CYAN" "$1" "$C_RESET"
}

pass() {
  printf "  %s[PASS]%s  %s\n" "$C_GREEN" "$C_RESET" "$1"
}

fail() {
  printf "  %s[FAIL]%s  %s\n" "$C_RED" "$C_RESET" "$1"
  FAILED=$((FAILED + 1))
}

warn() {
  printf "  %s[WARN]%s  %s\n" "$C_YELLOW" "$C_RESET" "$1"
}

info() {
  printf "  %s-->%s  %s\n" "$C_DIM" "$C_RESET" "$1"
}

pause() {
  printf "\n%s[MANUAL STEP]%s %s\n" "$C_YELLOW" "$C_RESET" "$1"
  printf "  Press Enter when done... "
  read -r
}

# ---------------------------------------------------------------------------
# 1. Precheck — Worker alive
# ---------------------------------------------------------------------------
section "1. Precheck: Worker health"

if curl -fs "$WEBFETCH_API/v1/health" -o /tmp/smoke-health.json; then
  STATUS=$(python3 -c "import json,sys; d=json.load(open('/tmp/smoke-health.json')); print(d.get('status','unknown'))" 2>/dev/null || echo "ok")
  pass "GET /v1/health → $STATUS"
else
  fail "GET /v1/health — Worker unreachable at $WEBFETCH_API"
  printf "\n%sWORKER IS DOWN — aborting smoke test.%s\n" "$C_RED" "$C_RESET"
  exit 1
fi

# ---------------------------------------------------------------------------
# 2. Provider availability
# ---------------------------------------------------------------------------
section "2. Provider pool availability"

if curl -fs "$WEBFETCH_API/v1/providers" -o /tmp/smoke-providers.json; then
  # Count providers that are available (platformProvidersAvailable array or top-level list).
  AVAIL=$(python3 - <<'EOF'
import json, sys
d = json.load(open('/tmp/smoke-providers.json'))
# Try common response shapes.
if isinstance(d, list):
    count = len(d)
elif isinstance(d, dict):
    arr = d.get('platformProvidersAvailable') or d.get('providers') or d.get('data') or []
    count = len(arr) if isinstance(arr, list) else 0
else:
    count = 0
print(count)
EOF
  )
  if [[ "$AVAIL" -ge 10 ]]; then
    pass "Provider pool: $AVAIL providers available"
  elif [[ "$AVAIL" -gt 0 ]]; then
    warn "Provider pool: only $AVAIL providers available (expected >=10 — run 'wrangler secret put PLATFORM_*' for missing keys)"
  else
    fail "Provider pool: 0 providers available — all PLATFORM_* secrets missing or /v1/providers shape unexpected"
  fi
else
  fail "GET /v1/providers — unexpected error"
fi

# ---------------------------------------------------------------------------
# 3. Free-tier 401 semantics
# ---------------------------------------------------------------------------
section "3. Free-tier auth enforcement"

HTTP_CODE=$(curl -s -o /dev/null -w "%{http_code}" \
  "$WEBFETCH_API/v1/search?q=test")

if [[ "$HTTP_CODE" == "401" ]]; then
  pass "Unauthenticated /v1/search → 401 (correct)"
elif [[ "$HTTP_CODE" == "403" ]]; then
  pass "Unauthenticated /v1/search → 403 (acceptable)"
else
  fail "Unauthenticated /v1/search → $HTTP_CODE (expected 401)"
fi

# ---------------------------------------------------------------------------
# 4. Manual steps — signup + Pro upgrade
# ---------------------------------------------------------------------------
section "4. Manual: Signup → Email verification → Pro upgrade"

info "Open $WEBFETCH_APP/login in your browser."
info "Sign up with: $TEST_EMAIL"
pause "Complete signup and verify the email in your inbox."

info "Go to $WEBFETCH_APP/billing → click Upgrade to Pro."
info "Use card 4242 4242 4242 4242 (test) or your real card (live mode)."
pause "Complete Stripe Checkout and wait for the plan to flip to 'pro' (~10s)."

info "Go to $WEBFETCH_APP/keys → Create API key → copy the key."

if [[ -z "${WEBFETCH_PRO_KEY:-}" ]]; then
  printf "\n  Paste your Pro API key and press Enter: "
  read -r WEBFETCH_PRO_KEY
fi

if [[ -z "$WEBFETCH_PRO_KEY" ]]; then
  fail "No Pro API key provided — skipping Pro tier checks"
  WEBFETCH_PRO_KEY=""
fi

# ---------------------------------------------------------------------------
# 5. Pro tier — pooled search
# ---------------------------------------------------------------------------
section "5. Pro tier: pooled provider search"

if [[ -n "$WEBFETCH_PRO_KEY" ]]; then
  PROVIDERS="unsplash,pexels,pixabay,flickr"

  if curl -fs \
      -H "Authorization: Bearer $WEBFETCH_PRO_KEY" \
      "$WEBFETCH_API/v1/search?q=nature&providers=$PROVIDERS" \
      -o /tmp/smoke-search.json; then

    # Check each provider returned count > 0.
    PROVIDER_RESULTS=$(python3 - <<'EOF'
import json, sys
d = json.load(open('/tmp/smoke-search.json'))
reports = d.get('providerReports') or d.get('results') or {}
failed = []
if isinstance(reports, list):
    for r in reports:
        name = r.get('provider') or r.get('name') or '?'
        count = r.get('count') or r.get('total') or len(r.get('results') or [])
        if count == 0:
            failed.append(name)
elif isinstance(reports, dict):
    for name, r in reports.items():
        count = r.get('count') or r.get('total') or 0
        if count == 0:
            failed.append(name)
if failed:
    print('fail:' + ','.join(failed))
else:
    print('pass')
EOF
    )

    if [[ "$PROVIDER_RESULTS" == "pass" ]]; then
      pass "Pooled search [$PROVIDERS] — all providers returned results"
    else
      MISSING="${PROVIDER_RESULTS#fail:}"
      fail "Pooled search — zero results from: $MISSING (check PLATFORM_* secrets for those providers)"
    fi
  else
    fail "Pro search request failed (HTTP error — check WEBFETCH_PRO_KEY and API reachability)"
  fi
else
  warn "Skipped (no Pro key)"
fi

# ---------------------------------------------------------------------------
# 6. Usage metering smoke
# ---------------------------------------------------------------------------
section "6. Usage metering"

if [[ -n "$WEBFETCH_PRO_KEY" ]]; then
  # Fire 3 more searches to accumulate usage.
  info "Firing 3 additional searches to accumulate usage..."
  for i in 1 2 3; do
    curl -fs \
      -H "Authorization: Bearer $WEBFETCH_PRO_KEY" \
      "$WEBFETCH_API/v1/search?q=smoke${i}" \
      -o /dev/null || true
  done

  # Hit /v1/usage and confirm count > 0.
  if curl -fs \
      -H "Authorization: Bearer $WEBFETCH_PRO_KEY" \
      "$WEBFETCH_API/v1/usage" \
      -o /tmp/smoke-usage.json; then

    USAGE_COUNT=$(python3 - <<'EOF'
import json, sys
d = json.load(open('/tmp/smoke-usage.json'))
# Accept several common shapes.
count = (
    d.get('total') or
    d.get('count') or
    d.get('fetches') or
    d.get('usage', {}).get('total') or
    d.get('usage', {}).get('count') or
    0
)
print(count)
EOF
    )

    if [[ "$USAGE_COUNT" -gt 0 ]]; then
      pass "Usage counter: $USAGE_COUNT requests recorded"
    else
      fail "Usage counter returned 0 — metering queue or D1 write may be broken"
      info "Check wrangler tail for queue consumer errors"
    fi
  else
    fail "GET /v1/usage failed"
  fi
else
  warn "Skipped (no Pro key)"
fi

# ---------------------------------------------------------------------------
# 7. Webhook smoke instructions (manual)
# ---------------------------------------------------------------------------
section "7. Webhook smoke (manual — Stripe CLI required)"

printf "\n"
info "Run these commands to exercise the webhook handler:"
printf "\n"
printf "  %s# Forward live webhook events to the production worker:%s\n" "$C_DIM" "$C_RESET"
printf "  stripe listen \\\\\n"
printf "    --forward-to %s/stripe/webhook \\\\\n" "$WEBFETCH_API"
printf "    --events checkout.session.completed,customer.subscription.created,\\\\\n"
printf "             customer.subscription.updated,customer.subscription.deleted,\\\\\n"
printf "             invoice.payment_failed\n\n"
printf "  %s# Trigger a subscription update (replace ws_xxx):%s\n" "$C_DIM" "$C_RESET"
printf "  stripe trigger customer.subscription.updated \\\\\n"
printf "    --override subscription:metadata.workspace_id=ws_xxx\n\n"
printf "  %s# Test idempotency (resend the same event — should be a no-op):%s\n" "$C_DIM" "$C_RESET"
printf "  stripe events resend evt_XXXXXXXX\n\n"
printf "  %s# Trigger a failed payment:%s\n" "$C_DIM" "$C_RESET"
printf "  stripe trigger invoice.payment_failed\n\n"
info "Verify: Stripe Dashboard → Developers → Webhooks → your endpoint → all deliveries show 200."
info "Verify: wrangler tail shows no unhandled 500s."

# ---------------------------------------------------------------------------
# Summary
# ---------------------------------------------------------------------------
printf "\n%s== Summary ==%s\n" "$C_BOLD" "$C_RESET"

if [[ $FAILED -eq 0 ]]; then
  printf "%s[ALL AUTOMATED CHECKS PASSED]%s\n\n" "$C_GREEN$C_BOLD" "$C_RESET"
  printf "  Complete the manual webhook verification above, then open signups.\n"
else
  printf "%s[%d CHECK(S) FAILED]%s\n\n" "$C_RED$C_BOLD" "$FAILED" "$C_RESET"
  printf "  Fix the failures above before opening signups.\n"
  exit 1
fi
