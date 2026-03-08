FROM node:24-alpine AS base
WORKDIR /app

# Install dependencies — copy all workspace package.json files
# so npm ci lockfile resolution matches the full monorepo structure
COPY package.json package-lock.json turbo.json tsconfig.base.json ./
COPY apps/agent-server/package.json apps/agent-server/
COPY apps/dashboard/package.json apps/dashboard/
COPY apps/discord-bot/package.json apps/discord-bot/
COPY packages/shared/package.json packages/shared/
COPY packages/db/package.json packages/db/
COPY packages/llm/package.json packages/llm/
COPY packages/sandbox/package.json packages/sandbox/
COPY packages/api-client/package.json packages/api-client/
COPY packages/queue/package.json packages/queue/
RUN npm ci --ignore-scripts --force

# Copy source and build
COPY packages/shared/ packages/shared/
COPY packages/db/ packages/db/
COPY packages/llm/ packages/llm/
COPY packages/sandbox/ packages/sandbox/
COPY packages/api-client/ packages/api-client/
COPY packages/queue/ packages/queue/
COPY apps/agent-server/ apps/agent-server/
COPY apps/dashboard/ apps/dashboard/
RUN rm -rf packages/*/node_modules/drizzle-orm \
    && npx turbo run build --filter=@ai-cofounder/agent-server --filter=@ai-cofounder/dashboard

# Production stage
FROM node:24-alpine
WORKDIR /app

# Install Docker CLI for sandbox code execution
RUN apk add --no-cache docker-cli

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
COPY --from=base /app/packages/queue/package.json packages/queue/
COPY --from=base /app/packages/queue/dist/ packages/queue/dist/
COPY --from=base /app/apps/agent-server/package.json apps/agent-server/
COPY --from=base /app/apps/agent-server/dist/ apps/agent-server/dist/
COPY apps/voice-ui/public/ apps/voice-ui/public/
COPY --from=base /app/apps/dashboard/dist/ apps/dashboard/dist/

RUN npm ci --omit=dev --ignore-scripts --force

ENV NODE_ENV=production
EXPOSE 3100

CMD ["node", "apps/agent-server/dist/index.js"]
