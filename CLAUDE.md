# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project Overview

AI Cofounder — a multi-agent system built as a Turborepo monorepo. The system orchestrates AI agents that collaborate to assist with business tasks, exposed through a Discord bot interface and automated via n8n workflows.

## Monorepo Structure

- **apps/agent-server** — Multi-agent orchestration service (core brain)
- **apps/discord-bot** — Discord bot providing the user-facing interface
- **apps/n8n** — n8n workflow automation (runs via Docker)
- **packages/shared** — Shared types, constants, and utilities consumed by apps
- **packages/db** — Database client, schema, and migrations

## Commands

```bash
npm run build          # Build all packages (turbo)
npm run dev            # Dev mode across all packages (turbo, persistent)
npm run lint           # Lint all packages
npm run test           # Test all packages
npm run clean          # Clean dist/ and .turbo/ caches

# Run a command in a specific workspace
npm run dev -w @ai-cofounder/agent-server
npm run test -w @ai-cofounder/discord-bot
```

## Architecture Notes

- Turborepo handles task orchestration with `turbo.json` defining the dependency graph (`build` depends on `^build` for correct ordering).
- Workspaces are defined in root `package.json` under `workspaces: ["apps/*", "packages/*"]`.
- The n8n app is Docker-based, not a typical Node build target.
- `packages/shared` and `packages/db` are internal packages consumed by the apps — changes to them trigger rebuilds of dependent apps.

## Environment

- Node.js v24.12.0, npm 11.6.2
- Docker + Docker Compose required for n8n and any containerized services
- No TypeScript, ESLint, or test runner configured yet — these are TODO
