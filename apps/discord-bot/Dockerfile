FROM node:24-alpine AS base
WORKDIR /app

# Install dependencies
COPY package.json package-lock.json turbo.json tsconfig.base.json ./
COPY apps/discord-bot/package.json apps/discord-bot/
COPY packages/shared/package.json packages/shared/
RUN npm ci --ignore-scripts --force

# Copy source and build
COPY packages/shared/ packages/shared/
COPY apps/discord-bot/ apps/discord-bot/
RUN npx turbo run build --filter=@ai-cofounder/discord-bot

# Production stage
FROM node:24-alpine
WORKDIR /app

COPY --from=base /app/package.json /app/package-lock.json /app/turbo.json ./
COPY --from=base /app/packages/shared/package.json packages/shared/
COPY --from=base /app/packages/shared/dist/ packages/shared/dist/
COPY --from=base /app/apps/discord-bot/package.json apps/discord-bot/
COPY --from=base /app/apps/discord-bot/dist/ apps/discord-bot/dist/

RUN npm ci --omit=dev --ignore-scripts --force

ENV NODE_ENV=production

CMD ["node", "apps/discord-bot/dist/index.js"]
