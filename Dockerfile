# Production image for the API (apps/api). The web app is deployed separately (Vercel) and is not part of it.
# Build context: the repository root. How to build and run it: docs/container.md.
#
# Stages: base (Node + pnpm) -> deps (install) -> build (compile, prune) -> runtime (what ships).
# The same image runs the API (default command) and the migrations (`node dist/db/migrate.js`).

ARG NODE_VERSION=24.22.1

# ---- base: Node and the pnpm version pinned in package.json ("packageManager"), activated through corepack
FROM node:${NODE_VERSION}-bookworm-slim AS base
ENV COREPACK_ENABLE_DOWNLOAD_PROMPT=0 \
    npm_config_update_notifier=false \
    npm_config_store_dir=/pnpm/store
WORKDIR /repo
COPY package.json ./
RUN corepack enable && corepack install

# ---- deps: install from the lockfile; only the manifests are copied, so this layer is rebuilt only when they change.
# The filter installs the API and what it depends on, plus the workspace root (the TypeScript compiler lives there).
FROM base AS deps
COPY pnpm-workspace.yaml pnpm-lock.yaml ./
COPY packages/config/package.json packages/config/
COPY packages/kit/package.json packages/kit/
COPY apps/api/package.json apps/api/
COPY apps/web/package.json apps/web/
RUN --mount=type=cache,id=pnpm-store,target=/pnpm/store \
    pnpm install --frozen-lockfile --filter "{./apps/api}..." --filter "."

# ---- build: compile the API and the packages it depends on, then prune to a production tree in /prod
FROM deps AS build
COPY tsconfig.base.json ./
COPY packages/config packages/config
COPY packages/kit packages/kit
COPY apps/api apps/api
RUN pnpm --filter "{./apps/api}..." build
# Type declarations are not needed to run the code.
RUN find apps/api/dist packages/kit/dist -name '*.d.ts' -delete
# Source maps (ours and the dependencies') are not needed either, so they are dropped from the pruned tree.
RUN --mount=type=cache,id=pnpm-store,target=/pnpm/store \
    pnpm --filter "{./apps/api}" deploy --prod --config.inject-workspace-packages=true /prod \
    && find /prod/dist /prod/node_modules -name '*.map' -delete

# ---- runtime: production dependencies, compiled code and SQL migrations only
FROM node:${NODE_VERSION}-bookworm-slim AS runtime
ARG PORT=3000
ENV NODE_ENV=production \
    PORT=${PORT}
WORKDIR /app
COPY --from=build /prod/package.json ./package.json
COPY --from=build /prod/node_modules ./node_modules
COPY --from=build /prod/dist ./dist
COPY --from=build /prod/drizzle ./drizzle
USER node
EXPOSE ${PORT}
# Readiness: answers 200 only while the API can reach its database.
HEALTHCHECK --interval=30s --timeout=5s --start-period=20s --retries=3 \
    CMD ["node", "-e", "fetch('http://127.0.0.1:' + process.env.PORT + '/health/ready', { signal: AbortSignal.timeout(4000) }).then((r) => process.exit(r.ok ? 0 : 1), () => process.exit(1))"]
CMD ["node", "dist/main.js"]
