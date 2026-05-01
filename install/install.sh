#!/usr/bin/env bash
# webfetch one-line installer.
#
# Installs the webfetch CLI + MCP server into $HOME/.webfetch and
# (optionally) wires it into Claude Code's settings.json.
#
# Idempotent: re-running updates the clone, rebuilds the CLI, and re-applies
# the Claude Code settings merge without duplicating keys.
#
# Usage:
#   curl -fsSL https://raw.githubusercontent.com/OWNER/REPO/main/install/install.sh | bash
#   curl -fsSL https://raw.githubusercontent.com/OWNER/REPO/main/install/install.sh | bash -s -- --yes
#
# Flags:
#   --yes          answer "yes" to every prompt (non-interactive installs)
#   --no-claude    skip the Claude Code settings merge
#   --no-symlink   skip creating the /usr/local/bin/webfetch symlink
#   --repo URL     override the repo URL (default: https://github.com/ashlrai/webfetch.git)
#   --ref REF      git ref to check out (default: main)
#   --prefix DIR   install dir (default: $HOME/.webfetch)

set -euo pipefail

REPO_URL_DEFAULT="https://github.com/ashlrai/webfetch.git"
REF_DEFAULT="main"
PREFIX_DEFAULT="$HOME/.webfetch"

ASSUME_YES=0
DO_CLAUDE=1
DO_SYMLINK=1
REPO_URL="$REPO_URL_DEFAULT"
REF="$REF_DEFAULT"
PREFIX="$PREFIX_DEFAULT"

while [ $# -gt 0 ]; do
  case "$1" in
    --yes|-y) ASSUME_YES=1 ;;
    --no-claude) DO_CLAUDE=0 ;;
    --no-symlink) DO_SYMLINK=0 ;;
    --repo) REPO_URL="$2"; shift ;;
    --ref) REF="$2"; shift ;;
    --prefix) PREFIX="$2"; shift ;;
    -h|--help)
      sed -n '2,22p' "$0" | sed 's/^# \{0,1\}//'
      exit 0
      ;;
    *) echo "unknown flag: $1" >&2; exit 2 ;;
  esac
  shift
done

say() { printf '\033[1;34m[webfetch]\033[0m %s\n' "$*"; }
warn() { printf '\033[1;33m[webfetch] warn:\033[0m %s\n' "$*" >&2; }
err() { printf '\033[1;31m[webfetch] error:\033[0m %s\n' "$*" >&2; }

confirm() {
  local prompt="$1"
  if [ "$ASSUME_YES" = "1" ]; then return 0; fi
  if [ ! -t 0 ]; then
    warn "non-interactive shell; pass --yes to auto-confirm \"$prompt\""
    return 1
  fi
  read -r -p "$prompt [y/N] " reply </dev/tty
  case "$reply" in y|Y|yes|YES) return 0 ;; *) return 1 ;; esac
}

# ---------- OS detection ----------
OS="$(uname -s)"
case "$OS" in
  Darwin) say "detected macOS" ;;
  Linux)  say "detected Linux" ;;
  MINGW*|MSYS*|CYGWIN*)
    err "Windows native shells are not supported. Please install WSL2 and re-run this script inside WSL."
    exit 1
    ;;
  *) warn "untested OS: $OS (continuing best-effort)" ;;
esac

# ---------- dependency: git ----------
if ! command -v git >/dev/null 2>&1; then
  err "git is required. Install git and re-run."
  exit 1
fi

# ---------- dependency: bun ----------
if ! command -v bun >/dev/null 2>&1; then
  say "bun not found on PATH."
  if confirm "Install bun via the official installer (curl https://bun.sh/install | bash)?"; then
    curl -fsSL https://bun.sh/install | bash
    # bun installer writes to ~/.bun/bin; add to PATH for the rest of this script
    export BUN_INSTALL="${BUN_INSTALL:-$HOME/.bun}"
    export PATH="$BUN_INSTALL/bin:$PATH"
  else
    err "bun is required. Install it and re-run."
    exit 1
  fi
fi
say "bun: $(bun --version)"

# ---------- clone / update repo ----------
REPO_DIR="$PREFIX/repo"
mkdir -p "$PREFIX"
if [ -d "$REPO_DIR/.git" ]; then
  say "updating existing checkout at $REPO_DIR"
  git -C "$REPO_DIR" fetch --quiet origin
  git -C "$REPO_DIR" checkout --quiet "$REF"
  git -C "$REPO_DIR" pull --quiet --ff-only origin "$REF" || warn "could not fast-forward; continuing"
else
  say "cloning $REPO_URL -> $REPO_DIR"
  git clone --quiet --branch "$REF" "$REPO_URL" "$REPO_DIR"
fi

# ---------- install deps + build CLI ----------
say "installing dependencies (bun install)"
( cd "$REPO_DIR" && bun install --silent )

say "building @webfetch/core (CLI depends on its types)"
( cd "$REPO_DIR" && bun run --cwd packages/core build )

say "building CLI"
( cd "$REPO_DIR" && bun run --cwd packages/cli build )

CLI_ENTRY="$REPO_DIR/packages/cli/dist/index.js"
if [ ! -f "$CLI_ENTRY" ]; then
  err "expected CLI build output at $CLI_ENTRY — build may have failed."
  exit 1
fi
chmod +x "$CLI_ENTRY" || true

# ---------- symlink ----------
install_symlink() {
  local target_dir="$1"
  local link="$target_dir/webfetch"
  mkdir -p "$target_dir"
  if [ -L "$link" ] || [ -f "$link" ]; then rm -f "$link"; fi
  # launch via bun so shebangs/node resolution work uniformly
  cat >"$link" <<EOF
#!/usr/bin/env bash
exec bun "$CLI_ENTRY" "\$@"
EOF
  chmod +x "$link"
  echo "$link"
}

if [ "$DO_SYMLINK" = "1" ]; then
  LINK=""
  if [ -w /usr/local/bin ] || confirm "Create /usr/local/bin/webfetch (may prompt for sudo)?"; then
    if [ -w /usr/local/bin ]; then
      LINK="$(install_symlink /usr/local/bin)"
    else
      if sudo -n true 2>/dev/null || confirm "sudo required to write /usr/local/bin. Continue?"; then
        sudo mkdir -p /usr/local/bin
        tmp="$(mktemp)"
        cat >"$tmp" <<EOF
#!/usr/bin/env bash
exec bun "$CLI_ENTRY" "\$@"
EOF
        sudo install -m 0755 "$tmp" /usr/local/bin/webfetch
        rm -f "$tmp"
        LINK="/usr/local/bin/webfetch"
      fi
    fi
  fi
  if [ -z "$LINK" ]; then
    LINK="$(install_symlink "$HOME/.local/bin")"
    case ":$PATH:" in
      *":$HOME/.local/bin:"*) : ;;
      *) warn "$HOME/.local/bin is not on PATH — add it to your shell rc." ;;
    esac
  fi
  say "installed launcher: $LINK"
fi

# ---------- Claude Code settings merge ----------
merge_claude_settings() {
  local settings="$HOME/.claude/settings.json"
  mkdir -p "$HOME/.claude"
  if [ ! -f "$settings" ]; then
    echo '{}' > "$settings"
  fi
  local bun_bin
  bun_bin="$(command -v bun)"
  local mcp_entry="$REPO_DIR/packages/mcp/src/index.ts"

  bun - <<EOF
import { readFileSync, writeFileSync, copyFileSync, existsSync } from "node:fs";
const path = "$settings";
let raw = "{}";
try { raw = readFileSync(path, "utf8") || "{}"; } catch {}
let json;
try { json = JSON.parse(raw); } catch (e) {
  console.error("existing settings.json is not valid JSON; refusing to overwrite. Path:", path);
  process.exit(1);
}
if (existsSync(path)) copyFileSync(path, path + ".bak." + Date.now());
json.mcpServers = json.mcpServers || {};
json.mcpServers.webfetch = {
  command: "$bun_bin",
  args: ["run", "$mcp_entry"],
  ...(json.mcpServers.webfetch?.env ? { env: json.mcpServers.webfetch.env } : {}),
};
writeFileSync(path, JSON.stringify(json, null, 2) + "\n");
console.log("merged webfetch into", path);
EOF
}

if [ "$DO_CLAUDE" = "1" ]; then
  if confirm "Wire webfetch into ~/.claude/settings.json (Claude Code MCP config)?"; then
    merge_claude_settings
  else
    say "skipped Claude Code settings merge (you can run it later with --yes)"
  fi
fi

# ---------- post-install message ----------
cat <<EOF

  webfetch installed.

  Repo:     $REPO_DIR
  Launcher: ${LINK:-"(not installed)"}

  Try it:
    webfetch providers
    webfetch search "drake portrait" --limit 5

  Wire into other tools:
    Claude Code -> $REPO_DIR/integrations/claude-code/
    Cursor      -> $REPO_DIR/integrations/cursor/
    Cline       -> $REPO_DIR/integrations/cline/
    Continue    -> $REPO_DIR/integrations/continue/
    Roo Code    -> $REPO_DIR/integrations/roo-code/
    Codex       -> $REPO_DIR/integrations/codex/

  Provider auth (optional) — export env vars before starting the MCP server:
    UNSPLASH_ACCESS_KEY, PEXELS_API_KEY, PIXABAY_API_KEY,
    BRAVE_API_KEY, SPOTIFY_CLIENT_ID/SPOTIFY_CLIENT_SECRET, SERPAPI_KEY.

  Re-run this script any time to update.

EOF
