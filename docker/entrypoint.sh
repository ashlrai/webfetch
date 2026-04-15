#!/usr/bin/env bash
# webfetch docker entrypoint — dispatches first arg to a subcommand.
#
#   docker run ghcr.io/ashlrai/webfetch cli providers
#   docker run -p 7600:7600 ghcr.io/ashlrai/webfetch server
#   docker run ghcr.io/ashlrai/webfetch mcp
#
# If the first arg is not a known subcommand, default to `cli` and forward all args.

set -euo pipefail

CMD="${1:-cli}"
shift || true

case "$CMD" in
  cli)
    exec node /app/packages/cli/dist/index.js "$@"
    ;;
  server)
    exec node /app/packages/server/dist/index.js "$@"
    ;;
  mcp)
    exec node /app/packages/mcp/dist/index.js "$@"
    ;;
  sh|bash)
    exec "$CMD" "$@"
    ;;
  *)
    # Backward compat: treat unrecognized first arg as a CLI arg.
    exec node /app/packages/cli/dist/index.js "$CMD" "$@"
    ;;
esac
