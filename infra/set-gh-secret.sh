#!/bin/bash
# Run locally after: gh auth login
WEBHOOK_URL="REDACTED_DISCORD_WEBHOOK_URL"
echo "$WEBHOOK_URL" | gh secret set DISCORD_DEPLOY_WEBHOOK_URL -R iansduncan-oss/ai-cofounder
echo "Done — DISCORD_DEPLOY_WEBHOOK_URL set."
