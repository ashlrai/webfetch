#!/usr/bin/env bash
# preflight.sh — verify webfetch is launch-ready.
# Usage:
#   scripts/preflight.sh           # human-readable
#   scripts/preflight.sh --json    # machine-readable JSON
# Exits 0 if ready, 1 otherwise.

set -u
set -o pipefail

# Resolve repo root (script lives in scripts/).
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="$(cd "$SCRIPT_DIR/.." && pwd)"
cd "$REPO_ROOT"

JSON_MODE=0
for arg in "$@"; do
  case "$arg" in
    --json) JSON_MODE=1 ;;
    -h|--help)
      echo "Usage: $0 [--json]"
      exit 0
      ;;
  esac
done

# Color helpers (disabled in JSON mode or when not a tty).
if [[ $JSON_MODE -eq 0 && -t 1 ]]; then
  C_BOLD=$'\033[1m'; C_DIM=$'\033[2m'; C_GREEN=$'\033[32m'
  C_RED=$'\033[31m'; C_YELLOW=$'\033[33m'; C_CYAN=$'\033[36m'; C_RESET=$'\033[0m'
else
  C_BOLD=""; C_DIM=""; C_GREEN=""; C_RED=""; C_YELLOW=""; C_CYAN=""; C_RESET=""
fi

# Result accumulators.
TOTAL=0
FAILED=0
WARNED=0
ISSUES=()         # human-readable issue strings
RESULTS_JSON=""   # JSON array body

section() {
  [[ $JSON_MODE -eq 1 ]] && return 0
  printf "\n%s%s== %s ==%s\n" "$C_BOLD" "$C_CYAN" "$1" "$C_RESET"
}

# record <id> <name> <status: pass|fail|warn> <detail>
record() {
  local id="$1" name="$2" status="$3" detail="${4:-}"
  TOTAL=$((TOTAL+1))
  case "$status" in
    pass)
      [[ $JSON_MODE -eq 0 ]] && printf "  %s[OK]%s  %s\n" "$C_GREEN" "$C_RESET" "$name"
      ;;
    warn)
      WARNED=$((WARNED+1))
      [[ $JSON_MODE -eq 0 ]] && printf "  %s[WARN]%s %s%s%s\n" "$C_YELLOW" "$C_RESET" "$name" "${detail:+ — }" "$detail"
      ;;
    fail)
      FAILED=$((FAILED+1))
      ISSUES+=("$id $name${detail:+ — $detail}")
      [[ $JSON_MODE -eq 0 ]] && printf "  %s[FAIL]%s %s%s%s\n" "$C_RED" "$C_RESET" "$name" "${detail:+ — }" "$detail"
      ;;
  esac
  # Append JSON entry.
  local esc_name esc_detail
  esc_name=$(printf '%s' "$name" | sed 's/\\/\\\\/g; s/"/\\"/g')
  esc_detail=$(printf '%s' "$detail" | sed 's/\\/\\\\/g; s/"/\\"/g')
  local entry
  entry=$(printf '{"id":"%s","name":"%s","status":"%s","detail":"%s"}' "$id" "$esc_name" "$status" "$esc_detail")
  if [[ -z "$RESULTS_JSON" ]]; then RESULTS_JSON="$entry"; else RESULTS_JSON="$RESULTS_JSON,$entry"; fi
}

check_file() {
  local id="$1" path="$2" label="${3:-$2}"
  if [[ -f "$REPO_ROOT/$path" ]]; then
    record "$id" "$label" pass
  else
    record "$id" "$label" fail "missing: $path"
  fi
}

check_dir_exists() {
  local id="$1" path="$2" label="${3:-$2}"
  if [[ -d "$REPO_ROOT/$path" ]]; then
    record "$id" "$label" pass
  else
    record "$id" "$label" fail "missing dir: $path"
  fi
}

# ------- 1. Repo hygiene -------
section "Repo hygiene"

check_file "1" "LICENSE" "Root LICENSE exists"

PUBLISHABLE_PACKAGES=("core" "cli" "mcp" "server" "browser")
for pkg in "${PUBLISHABLE_PACKAGES[@]}"; do
  if [[ -f "$REPO_ROOT/packages/$pkg/LICENSE" ]]; then
    record "2.$pkg" "packages/$pkg/LICENSE" pass
  else
    record "2.$pkg" "packages/$pkg/LICENSE" fail "missing"
  fi
done
# sdk-python: accept either LICENSE or license field in pyproject.toml
if [[ -f "$REPO_ROOT/packages/sdk-python/LICENSE" ]]; then
  record "2.sdk-python" "packages/sdk-python/LICENSE" pass
elif [[ -f "$REPO_ROOT/packages/sdk-python/pyproject.toml" ]] && grep -q -E '^license' "$REPO_ROOT/packages/sdk-python/pyproject.toml"; then
  record "2.sdk-python" "packages/sdk-python license (pyproject)" pass
else
  record "2.sdk-python" "packages/sdk-python LICENSE" fail "missing"
fi

check_file "3a" "CONTRIBUTING.md"
check_file "3b" "SECURITY.md"
check_file "3c" "CODE_OF_CONDUCT.md"
check_file "3d" "SUPPORT.md"

# ISSUE_TEMPLATE >= 3
if [[ -d "$REPO_ROOT/.github/ISSUE_TEMPLATE" ]]; then
  count=$(find "$REPO_ROOT/.github/ISSUE_TEMPLATE" -maxdepth 1 -type f \( -name '*.md' -o -name '*.yml' -o -name '*.yaml' \) | wc -l | tr -d ' ')
  if [[ "$count" -ge 3 ]]; then
    record "4" ".github/ISSUE_TEMPLATE/ has $count templates" pass
  else
    record "4" ".github/ISSUE_TEMPLATE/" fail "found $count templates, need >=3"
  fi
else
  record "4" ".github/ISSUE_TEMPLATE/" fail "directory missing"
fi

check_file "5" ".github/PULL_REQUEST_TEMPLATE.md"
check_file "6" ".github/CODEOWNERS"

# ------- 2. Build & tests -------
section "Build & tests"

if ! command -v bun >/dev/null 2>&1; then
  record "7" "bun install" fail "bun not installed"
  record "8" "bun run typecheck" fail "bun not installed"
  record "9" "bun test" fail "bun not installed"
else
  if (cd "$REPO_ROOT" && bun install >/tmp/preflight-install.log 2>&1); then
    record "7" "bun install" pass
  else
    record "7" "bun install" fail "see /tmp/preflight-install.log"
  fi

  if (cd "$REPO_ROOT" && bun run typecheck >/tmp/preflight-typecheck.log 2>&1); then
    record "8" "bun run typecheck" pass
  else
    if grep -qi "browser" /tmp/preflight-typecheck.log 2>/dev/null && grep -qi "no inputs were found\|empty" /tmp/preflight-typecheck.log 2>/dev/null; then
      record "8" "bun run typecheck" warn "@webfetch/browser empty-dir; non-blocking"
    else
      record "8" "bun run typecheck" fail "see /tmp/preflight-typecheck.log"
    fi
  fi

  if (cd "$REPO_ROOT" && bun test >/tmp/preflight-test.log 2>&1); then
    pass_count=$(grep -E "^\s*[0-9]+ pass" /tmp/preflight-test.log | tail -1 | grep -oE "[0-9]+" | head -1)
    pass_count=${pass_count:-0}
    if [[ "$pass_count" -ge 100 ]]; then
      record "9" "bun test ($pass_count passing)" pass
    else
      record "9" "bun test" fail "only $pass_count passing, need >=100"
    fi
  else
    record "9" "bun test" fail "see /tmp/preflight-test.log"
  fi
fi

# 10. npm pack --dry-run for each publishable JS package
if command -v npm >/dev/null 2>&1; then
  for pkg in "${PUBLISHABLE_PACKAGES[@]}"; do
    if [[ -f "$REPO_ROOT/packages/$pkg/package.json" ]]; then
      if (cd "$REPO_ROOT/packages/$pkg" && npm pack --dry-run >/tmp/preflight-pack-$pkg.log 2>&1); then
        record "10.$pkg" "npm pack --dry-run packages/$pkg" pass
      else
        record "10.$pkg" "npm pack --dry-run packages/$pkg" fail "see /tmp/preflight-pack-$pkg.log"
      fi
    fi
  done
else
  record "10" "npm pack --dry-run" fail "npm not installed"
fi

# ------- 3. CI workflows -------
section "CI workflows"

# 11. YAML parse — try python3 first, then fall back to a structural sanity check
yaml_validator=""
if command -v python3 >/dev/null 2>&1 && python3 -c "import yaml" >/dev/null 2>&1; then
  yaml_validator="python3"
fi

for f in "$REPO_ROOT"/.github/workflows/*.yml "$REPO_ROOT"/.github/workflows/*.yaml; do
  [[ -e "$f" ]] || continue
  rel="${f#$REPO_ROOT/}"
  if [[ "$yaml_validator" == "python3" ]]; then
    if python3 -c "import sys, yaml; yaml.safe_load(open(sys.argv[1]))" "$f" >/tmp/preflight-yaml.log 2>&1; then
      record "11.$(basename "$f")" "$rel parses" pass
    else
      record "11.$(basename "$f")" "$rel parses" fail "$(cat /tmp/preflight-yaml.log | tr '\n' ' ' | cut -c1-200)"
    fi
  else
    # Structural fallback: must contain top-level 'on:' and 'jobs:' keys.
    if grep -qE '^on:' "$f" && grep -qE '^jobs:' "$f"; then
      record "11.$(basename "$f")" "$rel structure ok (no python yaml)" warn "install pyyaml for full validation"
    else
      record "11.$(basename "$f")" "$rel" fail "missing on:/jobs:"
    fi
  fi
done

# 12. install/install.sh syntax
if [[ -f "$REPO_ROOT/install/install.sh" ]]; then
  if bash -n "$REPO_ROOT/install/install.sh" 2>/tmp/preflight-install-syntax.log; then
    record "12" "install/install.sh bash -n" pass
  else
    record "12" "install/install.sh bash -n" fail "$(cat /tmp/preflight-install-syntax.log)"
  fi
else
  record "12" "install/install.sh" fail "missing"
fi

# 13. docker/Dockerfile exists
check_file "13" "docker/Dockerfile" "docker/Dockerfile exists"

# ------- 4. Landing -------
section "Landing"

# 14. og-image: check for png 1200x630, accept svg as warn (current state).
OG_PNG="$REPO_ROOT/cloud/landing/public/og-image.png"
OG_SVG="$REPO_ROOT/cloud/landing/public/og-image.svg"
if [[ -f "$OG_PNG" ]]; then
  if command -v file >/dev/null 2>&1; then
    info=$(file "$OG_PNG")
    if echo "$info" | grep -qE "1200 ?x ?630"; then
      record "14" "og-image.png is 1200x630" pass
    else
      record "14" "og-image.png dimensions" fail "$(echo "$info" | sed 's/.*: //')"
    fi
  else
    record "14" "og-image.png exists (size unverified)" warn "install 'file' to verify dimensions"
  fi
elif [[ -f "$OG_SVG" ]]; then
  record "14" "og-image" warn "only svg present at cloud/landing/public/og-image.svg; need rasterized 1200x630 png for social"
else
  record "14" "og-image" fail "no og-image.png or og-image.svg in cloud/landing/public/"
fi

# 15. landing build
if command -v bun >/dev/null 2>&1 && [[ -f "$REPO_ROOT/cloud/landing/package.json" ]]; then
  if (cd "$REPO_ROOT" && bun run --cwd cloud/landing build >/tmp/preflight-landing-build.log 2>&1); then
    record "15" "cloud/landing build" pass
  else
    record "15" "cloud/landing build" fail "see /tmp/preflight-landing-build.log"
  fi
else
  record "15" "cloud/landing build" fail "bun or cloud/landing missing"
fi

# ------- 5. Cloud -------
section "Cloud"

# 16. workers tests
if command -v bun >/dev/null 2>&1 && [[ -d "$REPO_ROOT/cloud/workers" ]]; then
  if (cd "$REPO_ROOT/cloud/workers" && bun test >/tmp/preflight-workers-test.log 2>&1); then
    record "16" "cloud/workers tests" pass
  else
    record "16" "cloud/workers tests" fail "see /tmp/preflight-workers-test.log"
  fi
else
  record "16" "cloud/workers tests" fail "cloud/workers missing or bun unavailable"
fi

# 17. dashboard build
if [[ -d "$REPO_ROOT/cloud/dashboard" ]] && [[ -f "$REPO_ROOT/cloud/dashboard/package.json" ]]; then
  if command -v bun >/dev/null 2>&1; then
    if (cd "$REPO_ROOT" && bun run --cwd cloud/dashboard build >/tmp/preflight-dashboard-build.log 2>&1); then
      record "17" "cloud/dashboard build" pass
    else
      record "17" "cloud/dashboard build" fail "see /tmp/preflight-dashboard-build.log"
    fi
  else
    record "17" "cloud/dashboard build" fail "bun unavailable"
  fi
else
  record "17" "cloud/dashboard build" fail "cloud/dashboard missing"
fi

# 18. schema 0001_init.sql
check_file "18" "cloud/schema/0001_init.sql"

# ------- 6. Env secrets -------
section "Env secrets (informational only)"

REQUIRED_SECRETS=(
  "NPM_TOKEN"
  "GHCR_TOKEN"
  "HOMEBREW_GH_TOKEN"
  "CLOUDFLARE_API_TOKEN"
  "STRIPE_SECRET_KEY"
  "STRIPE_WEBHOOK_SECRET"
  "RESEND_API_KEY"
  "VERCEL_TOKEN"
)
SECRETS_JSON=""
for s in "${REQUIRED_SECRETS[@]}"; do
  if [[ -n "${!s:-}" ]]; then
    if [[ $JSON_MODE -eq 0 ]]; then printf "  %s[OK]%s  %s present in local env\n" "$C_GREEN" "$C_RESET" "$s"; fi
    entry=$(printf '{"name":"%s","present":true}' "$s")
  else
    if [[ $JSON_MODE -eq 0 ]]; then printf "  %s[--]%s  %s not in local env (set as GitHub secret before launch)\n" "$C_DIM" "$C_RESET" "$s"; fi
    entry=$(printf '{"name":"%s","present":false}' "$s")
  fi
  if [[ -z "$SECRETS_JSON" ]]; then SECRETS_JSON="$entry"; else SECRETS_JSON="$SECRETS_JSON,$entry"; fi
done

# ------- Summary -------
EXIT_CODE=0
if [[ $FAILED -gt 0 ]]; then EXIT_CODE=1; fi

if [[ $JSON_MODE -eq 1 ]]; then
  status="ready"
  [[ $FAILED -gt 0 ]] && status="not_ready"
  printf '{"status":"%s","total":%d,"failed":%d,"warned":%d,"checks":[%s],"secrets":[%s]}\n' \
    "$status" "$TOTAL" "$FAILED" "$WARNED" "$RESULTS_JSON" "$SECRETS_JSON"
else
  echo
  echo "${C_BOLD}== Summary ==${C_RESET}"
  printf "  Checks: %d total, %s%d passed%s, %s%d warnings%s, %s%d failed%s\n" \
    "$TOTAL" \
    "$C_GREEN" "$((TOTAL-FAILED-WARNED))" "$C_RESET" \
    "$C_YELLOW" "$WARNED" "$C_RESET" \
    "$C_RED" "$FAILED" "$C_RESET"
  if [[ $FAILED -gt 0 ]]; then
    echo
    echo "${C_BOLD}${C_RED}NOT READY: $FAILED issues${C_RESET}"
    i=1
    for issue in "${ISSUES[@]}"; do
      printf "  %2d. %s\n" "$i" "$issue"
      i=$((i+1))
    done
  else
    echo
    echo "${C_BOLD}${C_GREEN}READY TO LAUNCH${C_RESET}"
  fi
fi

exit $EXIT_CODE
