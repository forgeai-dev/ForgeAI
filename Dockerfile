# ─── Stage 1: Build ──────────────────────────────────
FROM node:22-slim AS builder

RUN corepack enable && corepack prepare pnpm@latest --activate

WORKDIR /app

# Copy workspace config
COPY package.json pnpm-workspace.yaml pnpm-lock.yaml* ./

# Copy all package.json files
COPY packages/shared/package.json packages/shared/
COPY packages/security/package.json packages/security/
COPY packages/core/package.json packages/core/
COPY packages/agent/package.json packages/agent/
COPY packages/channels/package.json packages/channels/
COPY packages/tools/package.json packages/tools/
COPY packages/plugins/package.json packages/plugins/
COPY packages/workflows/package.json packages/workflows/
COPY packages/cli/package.json packages/cli/
COPY packages/dashboard/package.json packages/dashboard/
COPY packages/desktop/package.json packages/desktop/

# Install dependencies
RUN pnpm install --frozen-lockfile --ignore-scripts

# Copy source
COPY packages/ packages/
COPY tsconfig.json ./

# Build all packages (order matters)
RUN pnpm --filter @forgeai/shared build && \
    pnpm --filter @forgeai/security build && \
    pnpm --filter @forgeai/agent build && \
    pnpm --filter @forgeai/channels build && \
    pnpm --filter @forgeai/tools build && \
    pnpm --filter @forgeai/plugins build && \
    pnpm --filter @forgeai/workflows build && \
    pnpm --filter @forgeai/core build && \
    pnpm --filter @forgeai/cli build

# Build dashboard
RUN pnpm --filter @forgeai/dashboard build

# ─── Stage 2: Production ─────────────────────────────
FROM node:22-slim AS production

RUN corepack enable && corepack prepare pnpm@latest --activate

# Install Chromium for Puppeteer
RUN apt-get update && \
    apt-get install -y --no-install-recommends chromium && \
    rm -rf /var/lib/apt/lists/*

ENV PUPPETEER_SKIP_CHROMIUM_DOWNLOAD=true
ENV PUPPETEER_EXECUTABLE_PATH=/usr/bin/chromium

WORKDIR /app

# Copy workspace config
COPY package.json pnpm-workspace.yaml pnpm-lock.yaml* ./
COPY packages/shared/package.json packages/shared/
COPY packages/security/package.json packages/security/
COPY packages/core/package.json packages/core/
COPY packages/agent/package.json packages/agent/
COPY packages/channels/package.json packages/channels/
COPY packages/tools/package.json packages/tools/
COPY packages/plugins/package.json packages/plugins/
COPY packages/workflows/package.json packages/workflows/
COPY packages/cli/package.json packages/cli/
COPY packages/dashboard/package.json packages/dashboard/
COPY packages/desktop/package.json packages/desktop/

# Install production dependencies only
RUN pnpm install --frozen-lockfile --prod --ignore-scripts

# Copy built artifacts
COPY --from=builder /app/packages/shared/dist packages/shared/dist
COPY --from=builder /app/packages/security/dist packages/security/dist
COPY --from=builder /app/packages/core/dist packages/core/dist
COPY --from=builder /app/packages/agent/dist packages/agent/dist
COPY --from=builder /app/packages/channels/dist packages/channels/dist
COPY --from=builder /app/packages/tools/dist packages/tools/dist
COPY --from=builder /app/packages/plugins/dist packages/plugins/dist
COPY --from=builder /app/packages/workflows/dist packages/workflows/dist
COPY --from=builder /app/packages/cli/dist packages/cli/dist
COPY --from=builder /app/packages/dashboard/dist packages/dashboard/dist

# Copy migrations
COPY packages/core/src/database packages/core/src/database

# Create data directory
RUN mkdir -p /app/.forgeai

# Expose ports
EXPOSE 18800

# Health check
HEALTHCHECK --interval=30s --timeout=5s --start-period=10s --retries=3 \
  CMD node -e "fetch('http://localhost:18800/health').then(r=>{if(!r.ok)process.exit(1)}).catch(()=>process.exit(1))"

# Start gateway
CMD ["node", "packages/cli/dist/index.js", "start", "--migrate"]
