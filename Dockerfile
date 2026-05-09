# Glama-compatible MCP entrypoint.
# The canonical multi-command production image is built from docker/Dockerfile.
FROM node:20-slim

RUN npm install -g getwebfetch-mcp@0.1.5 \
 && npm cache clean --force

CMD ["getwebfetch-mcp"]
