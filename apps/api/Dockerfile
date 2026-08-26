# Node, not Bun, in production. ADR-002: NestJS decorator metadata and the
# Prisma query engine binary are not where you want a surprise on day 16 of a
# three week build. Bun still runs install and the test suite.
FROM node:22-slim AS base
WORKDIR /app
# Prisma needs OpenSSL to pick its engine at runtime.
RUN apt-get update && apt-get install -y --no-install-recommends openssl ca-certificates \
    && rm -rf /var/lib/apt/lists/*

FROM base AS deps
COPY package.json bun.lock ./
COPY apps/api/package.json apps/api/
COPY packages/shared/package.json packages/shared/
RUN npm install --workspaces --include-workspace-root --no-audit --no-fund

FROM base AS build
COPY --from=deps /app/node_modules ./node_modules
COPY --from=deps /app/apps/api/node_modules ./apps/api/node_modules
COPY . .
RUN npx --workspace @bobs-momo/api prisma generate \
    && npm run shared:build \
    && npm run --workspace @bobs-momo/api build

FROM base AS runtime
ENV NODE_ENV=production TZ=Asia/Kolkata
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
CMD ["sh", "-c", "npx --workspace @bobs-momo/api prisma migrate deploy && node apps/api/dist/main"]
