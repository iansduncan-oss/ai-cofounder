# Next Session Prompt

Pick up where we left off. Here's the context:

## What was done (2026-04-07 to 2026-04-09)

### YouTube Shorts Pipeline (major overhaul)
- Replaced Edge TTS with **Kokoro TTS** (self-hosted, free, #1 TTS Arena) — voices: `bm_george` (CTC), `am_adam` (WAW)
- Kokoro runs at `kokoro-fastapi-cpu-kokoro-tts-1:8880` on VPS, Edge TTS proxies to it via `use_kokoro: true`
- 12 shots at 2-3s (was 5-6 at 6-10s), 25-30s total (was 50-60s)
- Loop-friendly endings (script prompt requires callback to opening hook)
- Compound Ken Burns effects (snapZoom, spiralIn, slowReveal + more dramatic existing)
- Transition SFX (9 whoosh/impact/riser files at `/app/sfx/`)
- Faster crossfades (0.25-0.6s range)
- BGM restored (volume mount was missing)
- [PAUSE] stripped from narration before TTS
- Subscribe CTA removed from video
- Subtitle timing via ffprobe (was char-count estimate)
- MinIO staging for public URLs (Postiz TLS fix)
- Flux retry logic (fallback to previous shot on empty output)

### Infrastructure
- Restic + B2 offsite backups: working, cron at 3 AM daily
- Homepage dashboard: running on VPS:3300 (needs NPM proxy host)
- All 3 free provider API keys live on VPS
- Gmail + Calendar APIs enabled
- Discord watcher configured
- 14 Dependabot vulns → 0
- All CI green, auto-deploy working

### Cost Optimization
- Routes: Groq first (cheap $0.59/1M), Anthropic fallback ($3/1M), Ollama free
- 5 unused providers removed from registration
- Budget alerts post to Discord

## What needs attention first

### 1. Watch the 9 AM PT YouTube Shorts run
The scheduled daily run will be the first with ALL improvements (Kokoro, fast pacing, SFX, compound motion). Watch the output video and check:
- Does the voice sound natural? (Kokoro `bm_george` for CTC)
- Are subtitles synced? (ffprobe timing may need tuning)
- Do transitions feel fast enough? (should be rapid 2-3s cuts)
- Does the ending loop well? (final line should echo the hook)
- Are SFX whooshes audible but not overwhelming? (volume 0.3)

### 2. Remaining manual tasks
- **NPM proxy host**: `dashboard.aviontechs.com` → `homepage:3000` (NPM password unknown, needs browser)
- **Slack manifest**: import `apps/slack-bot/manifest.json` at api.slack.com
- **Save Restic password**: `avion-restic-2026-xK9mPv3nQ7wR` → Vaultwarden
- **Anthropic credits**: top up at console.anthropic.com

### 3. Jarvis upgrades (next features)
From the roadmap, these are the next tier:
- **Memory bridge**: sync agent memories to `.claude/primer.md` and Obsidian vault
- **n8n action templates**: CI rerun, GitHub issue creation, backlog add via pattern matching
- **Voice UI polish**: mobile-friendly frontend for the voice endpoint
- **Proactive intelligence**: pattern detection, trend alerts

### 4. Atlas Phase 2
Homelab infra foundations are next:
- Grafana LGTM stack (add Loki + Tempo)
- Authentik SSO
- AdGuard Home + Unbound DNS

### 5. Known issues
- Replicate Flux occasionally returns empty for a shot — retry logic added but not yet tested in production
- Kokoro container needs to be added to a proper docker-compose (currently started manually from `/tmp/kokoro-fastapi`)
- Edge TTS service Dockerfile has `httpx` added but the container image should be pinned to a version
- Videos are still slideshows — next iteration could add depth-based parallax ($0.10/video via DepthAnything)
- OpenRouter rate limits if you trigger multiple test runs back-to-back — wait 2+ minutes between triggers

## Key file locations

| What | Where |
|------|-------|
| n8n workflow | VPS n8n ID `cZj7dc7nNz785PGO` |
| FFmpeg render | VPS `/opt/ffmpeg-render-service/` + local `n8n-workflows/ffmpeg-render-service/` |
| Edge TTS + Kokoro proxy | VPS `/opt/ai-cofounder/edge-tts-service/` |
| Kokoro TTS | VPS `/tmp/kokoro-fastapi/` (needs proper home) |
| SFX files | VPS `/opt/ffmpeg-render-service/sfx/` |
| BGM files | VPS `/opt/ffmpeg-render-service/music/` |
| Backup script | VPS `/opt/ai-cofounder/infra/scripts/vps/backup-offsite.sh` |
| Homepage | VPS `/opt/homepage/` |
| Memory files | `~/.claude/projects/-Users-ianduncan/memory/` |
