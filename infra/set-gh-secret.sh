#!/bin/bash
# Run locally after: gh auth login
# Usage: DISCORD_DEPLOY_WEBHOOK_URL="https://discord.com/api/webhooks/..." ./infra/set-gh-secret.sh

if [ -z "$DISCORD_DEPLOY_WEBHOOK_URL" ]; then
  echo "Error: DISCORD_DEPLOY_WEBHOOK_URL environment variable is required."
  echo "Usage: DISCORD_DEPLOY_WEBHOOK_URL=\"https://...\" $0"
  exit 1
fi

echo "$DISCORD_DEPLOY_WEBHOOK_URL" | gh secret set DISCORD_DEPLOY_WEBHOOK_URL -R iansduncan-oss/ai-cofounder
echo "Done — DISCORD_DEPLOY_WEBHOOK_URL set."
