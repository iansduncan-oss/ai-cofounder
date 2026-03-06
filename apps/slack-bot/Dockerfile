FROM node:24-alpine AS base
WORKDIR /app

# Install dependencies
COPY package.json package-lock.json turbo.json tsconfig.base.json ./
COPY apps/slack-bot/package.json apps/slack-bot/
COPY packages/shared/package.json packages/shared/
COPY packages/api-client/package.json packages/api-client/
COPY packages/bot-handlers/package.json packages/bot-handlers/
RUN npm ci --ignore-scripts --force

# Copy source and build
COPY packages/shared/ packages/shared/
COPY packages/api-client/ packages/api-client/
COPY packages/bot-handlers/ packages/bot-handlers/
COPY apps/slack-bot/ apps/slack-bot/
RUN npx turbo run build --filter=@ai-cofounder/slack-bot

# Production stage
FROM node:24-alpine
WORKDIR /app

COPY --from=base /app/package.json /app/package-lock.json /app/turbo.json ./
COPY --from=base /app/packages/shared/package.json packages/shared/
COPY --from=base /app/packages/shared/dist/ packages/shared/dist/
COPY --from=base /app/packages/api-client/package.json packages/api-client/
COPY --from=base /app/packages/api-client/dist/ packages/api-client/dist/
COPY --from=base /app/packages/bot-handlers/package.json packages/bot-handlers/
COPY --from=base /app/packages/bot-handlers/dist/ packages/bot-handlers/dist/
COPY --from=base /app/apps/slack-bot/package.json apps/slack-bot/
COPY --from=base /app/apps/slack-bot/dist/ apps/slack-bot/dist/

RUN npm ci --omit=dev --ignore-scripts --force

ENV NODE_ENV=production

CMD ["node", "apps/slack-bot/dist/index.js"]
