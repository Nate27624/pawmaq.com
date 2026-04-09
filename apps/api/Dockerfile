FROM node:22-alpine AS build

WORKDIR /app
RUN corepack enable

COPY package.json pnpm-lock.yaml pnpm-workspace.yaml tsconfig.base.json ./
COPY apps/api/package.json apps/api/tsconfig.json ./apps/api/
RUN corepack pnpm install --frozen-lockfile

COPY apps/api/src ./apps/api/src
RUN corepack pnpm --filter @pawmaq/api build

FROM node:22-alpine AS runtime

WORKDIR /app
RUN corepack enable

COPY package.json pnpm-lock.yaml pnpm-workspace.yaml ./
COPY apps/api/package.json ./apps/api/package.json
RUN corepack pnpm install --frozen-lockfile --prod --filter @pawmaq/api

COPY --from=build /app/apps/api/dist ./apps/api/dist

EXPOSE 3000
CMD ["node", "apps/api/dist/index.js"]
