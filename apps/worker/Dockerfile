# Build from the repo root:  docker build -f apps/worker/Dockerfile -t outreach-worker .
FROM node:22-slim
RUN corepack enable && corepack prepare pnpm@9.15.9 --activate
WORKDIR /app
COPY pnpm-lock.yaml pnpm-workspace.yaml package.json .npmrc tsconfig.base.json ./
COPY apps/worker/package.json apps/worker/
COPY packages/adapters/package.json packages/adapters/
COPY packages/core/package.json packages/core/
COPY packages/db/package.json packages/db/
RUN pnpm install --frozen-lockfile --filter @outreach/worker...
COPY packages packages
COPY apps/worker apps/worker
ENV NODE_ENV=production
WORKDIR /app/apps/worker
CMD ["pnpm", "start"]
