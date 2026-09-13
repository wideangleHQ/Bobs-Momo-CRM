# Node, not Bun, in production runtime. ADR-002: NestJS decorator metadata and the
# Prisma query engine binary run under Node 22 LTS in production.
# Bun is used for multi-stage dependency installation and builds to support Bun monorepo workspace:* dependencies.

FROM oven/bun:1-slim AS deps
WORKDIR /app
# Prisma and native dependencies need OpenSSL and CA certs
RUN apt-get update && apt-get install -y --no-install-recommends openssl ca-certificates \
    && rm -rf /var/lib/apt/lists/*

COPY package.json bun.lock ./
COPY apps/api/package.json apps/api/
COPY packages/shared/package.json packages/shared/
COPY apps/web/package.json apps/web/
RUN bun install --frozen-lockfile

FROM oven/bun:1-slim AS build
WORKDIR /app
RUN apt-get update && apt-get install -y --no-install-recommends openssl ca-certificates \
    && rm -rf /var/lib/apt/lists/*

COPY --from=deps /app/node_modules ./node_modules
COPY --from=deps /app/apps/api/node_modules ./apps/api/node_modules
COPY --from=deps /app/packages/shared/node_modules ./packages/shared/node_modules
COPY . .
RUN bun run --cwd apps/api db:generate \
    && bun run shared:build \
    && bun run --cwd apps/api build

FROM node:22-slim AS runtime
WORKDIR /app
# Prisma needs OpenSSL to pick its engine at runtime.
RUN apt-get update && apt-get install -y --no-install-recommends openssl ca-certificates \
    && rm -rf /var/lib/apt/lists/*

ENV NODE_ENV=production TZ=Asia/Kolkata
ENV PATH="/app/node_modules/.bin:/app/apps/api/node_modules/.bin:$PATH"

COPY --from=build /app/node_modules ./node_modules
COPY --from=build /app/apps/api/node_modules ./apps/api/node_modules
COPY --from=build /app/apps/api/dist ./apps/api/dist
COPY --from=build /app/apps/api/prisma ./apps/api/prisma
COPY --from=build /app/packages/shared/dist ./packages/shared/dist
COPY --from=build /app/packages/shared/package.json ./packages/shared/package.json
COPY --from=build /app/apps/api/package.json ./apps/api/package.json
COPY --from=build /app/package.json ./package.json

# Not root. A container that only has to run one Node process has no reason to.
USER node
EXPOSE 3001

# Migrations run on boot rather than in a separate step, because Railway has no
# release phase. migrate deploy is idempotent and applies only pending files,
# so a restart is safe. It uses DIRECT_URL: prisma migrate cannot run through
# the Supavisor transaction pooler.
CMD ["sh", "-c", "prisma migrate deploy --schema=apps/api/prisma/schema.prisma && node apps/api/dist/main"]
