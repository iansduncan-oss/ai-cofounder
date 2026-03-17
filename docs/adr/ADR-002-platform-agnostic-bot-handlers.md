# ADR-002: Platform-Agnostic Bot Handlers

## Status

Accepted

## Context

The system supports two chat platforms (Discord and Slack) with identical command sets (8 slash commands each). Initially, each bot had its own command handling logic, leading to duplicated business logic and divergent behavior.

Three approaches were considered:

1. **Per-bot logic** — Each bot implements its own handlers (status quo before refactor)
2. **Shared handler package** — Extract platform-agnostic handlers into `@ai-cofounder/bot-handlers`
3. **API-only bots** — Bots are thin wrappers that forward all input to the agent-server API

## Decision

Use a **shared `bot-handlers` package** (option 2).

- `packages/bot-handlers` contains platform-agnostic command handlers that accept a typed `CommandContext` and return a `CommandResult`
- Each bot (Discord, Slack) is a thin adapter: parses platform-specific input into `CommandContext`, calls the shared handler, formats `CommandResult` back to platform-specific output
- Both bots use `@ai-cofounder/api-client` for all server communication
- New commands are added once in `bot-handlers` and automatically available on both platforms

## Consequences

**Benefits:**
- Single source of truth for command behavior — no drift between platforms
- Adding a new platform (e.g., Telegram, Teams) requires only a thin adapter
- Testing is simpler: test handlers once with mock `CommandContext`
- Business logic changes propagate to all platforms simultaneously

**Trade-offs:**
- Abstraction layer adds indirection (platform adapter → handler → API client)
- Platform-specific features (Discord embeds, Slack blocks) require conditional formatting in the adapter layer
- The `CommandContext` type must accommodate the union of all platform capabilities

**Files:** `packages/bot-handlers/`, `packages/api-client/`, `apps/discord-bot/`, `apps/slack-bot/`
