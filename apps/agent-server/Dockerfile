FROM node:24-alpine AS base
WORKDIR /app

# Install dependencies — copy all workspace package.json files
# so npm ci lockfile resolution matches the full monorepo structure
COPY package.json package-lock.json turbo.json tsconfig.base.json ./
COPY apps/agent-server/package.json apps/agent-server/
COPY apps/discord-bot/package.json apps/discord-bot/
COPY packages/shared/package.json packages/shared/
COPY packages/db/package.json packages/db/
COPY packages/llm/package.json packages/llm/
COPY packages/sandbox/package.json packages/sandbox/
RUN npm ci --ignore-scripts --force

# Copy source and build
COPY packages/shared/ packages/shared/
COPY packages/db/ packages/db/
COPY packages/llm/ packages/llm/
COPY packages/sandbox/ packages/sandbox/
COPY apps/agent-server/ apps/agent-server/
RUN rm -rf packages/*/node_modules/drizzle-orm \
    && npx turbo run build --filter=@ai-cofounder/agent-server

# Production stage
FROM node:24-alpine
WORKDIR /app

COPY --from=base /app/package.json /app/package-lock.json /app/turbo.json ./
COPY --from=base /app/packages/shared/package.json packages/shared/
COPY --from=base /app/packages/shared/dist/ packages/shared/dist/
COPY --from=base /app/packages/db/package.json packages/db/
COPY --from=base /app/packages/db/dist/ packages/db/dist/
COPY --from=base /app/packages/db/drizzle/ packages/db/drizzle/
COPY --from=base /app/packages/llm/package.json packages/llm/
COPY --from=base /app/packages/llm/dist/ packages/llm/dist/
COPY --from=base /app/packages/sandbox/package.json packages/sandbox/
COPY --from=base /app/packages/sandbox/dist/ packages/sandbox/dist/
COPY --from=base /app/apps/agent-server/package.json apps/agent-server/
COPY --from=base /app/apps/agent-server/dist/ apps/agent-server/dist/

RUN npm ci --omit=dev --ignore-scripts --force

ENV NODE_ENV=production
EXPOSE 3100

CMD ["node", "apps/agent-server/dist/index.js"]
