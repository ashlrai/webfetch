# syntax=docker/dockerfile:1.7

# -------- Stage 1: build with Bun --------
FROM oven/bun:1.3 AS builder
WORKDIR /src

# Copy manifest files first for better cache behavior.
COPY package.json bun.lock tsconfig.json ./
COPY packages/core/package.json packages/core/package.json
COPY packages/cli/package.json packages/cli/package.json
COPY packages/mcp/package.json packages/mcp/package.json
COPY packages/server/package.json packages/server/package.json

RUN bun install --frozen-lockfile

# Copy sources.
COPY packages ./packages

# Build each publishable package.
RUN bun run --cwd packages/core build \
 && bun run --cwd packages/cli build \
 && bun run --cwd packages/mcp build \
 && bun run --cwd packages/server build

# -------- Stage 2: slim Node runtime --------
FROM node:20-slim AS runtime

# sharp prebuilt binaries + curl for healthchecks.
RUN apt-get update \
 && apt-get install -y --no-install-recommends ca-certificates curl \
 && rm -rf /var/lib/apt/lists/*

WORKDIR /app

# Copy built packages + their package.jsons (for runtime deps resolution).
COPY --from=builder /src/packages/core/dist       /app/packages/core/dist
COPY --from=builder /src/packages/core/package.json /app/packages/core/package.json
COPY --from=builder /src/packages/cli/dist        /app/packages/cli/dist
COPY --from=builder /src/packages/cli/package.json /app/packages/cli/package.json
COPY --from=builder /src/packages/mcp/dist        /app/packages/mcp/dist
COPY --from=builder /src/packages/mcp/package.json /app/packages/mcp/package.json
COPY --from=builder /src/packages/server/dist     /app/packages/server/dist
COPY --from=builder /src/packages/server/package.json /app/packages/server/package.json
COPY --from=builder /src/package.json             /app/package.json
COPY --from=builder /src/bun.lock                 /app/bun.lock

# Install production dependencies using npm (since runtime is Node).
# We install only the runtime deps needed by the built artifacts.
RUN npm install --omit=dev --no-audit --no-fund \
      sharp@^0.33.0 \
      @modelcontextprotocol/sdk@^1.0.4 \
      zod@^3.23.8 \
 && npm cache clean --force

COPY docker/entrypoint.sh /usr/local/bin/webfetch-entrypoint
RUN chmod +x /usr/local/bin/webfetch-entrypoint

EXPOSE 7600

ENTRYPOINT ["/usr/local/bin/webfetch-entrypoint"]
CMD ["cli", "--help"]
