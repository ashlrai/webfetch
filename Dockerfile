# Glama-compatible MCP entrypoint.
# The canonical multi-command production image is built from docker/Dockerfile.
FROM ghcr.io/ashlrai/webfetch:latest

CMD ["mcp"]
