# Enhanced Briefings with TTS Audio

## Context

The HUD page displays daily briefings as plain text in a card. The TTS service (`services/tts.ts`) exists and works — the voice UI uses it for every response. But briefings have zero audio integration. Users read walls of text instead of hearing a spoken summary from their AI cofounder.

This feature adds a "Play briefing" button to the HUD that synthesizes the briefing text via ElevenLabs and plays it inline. It also wires up the `deliveryChannels` field in `BriefingJob` so queued briefings can include a pre-generated audio URL.

No new DB tables. No new queue jobs.

---

## 1. Briefing Audio Endpoint

**File:** `apps/agent-server/src/routes/health.ts`

Add `GET /api/briefing/audio` — generates and returns MP3 audio of the current briefing.

1. Call `gatherBriefingData(db)` + `generateLlmBriefing(registry, data)` to get the narrative text (same as `?send=true` but without delivering to Slack/Discord)
2. Pass text to `ttsService.synthesize(text, personaVoiceId)` — respect active persona's voice
3. Return the MP3 buffer with `Content-Type: audio/mpeg`
4. Return 503 if TTS is not configured, 500 if synthesis fails

This mirrors the existing `POST /voice/tts` pattern but is purpose-built for briefings — the caller doesn't need to know the briefing text, just hits one endpoint and gets audio back.

```typescript
app.get("/api/briefing/audio", async (request, reply) => {
  if (!ttsService) return reply.status(503).send({ error: "TTS not configured" });
  const data = await gatherBriefingData(app.db);
  const text = app.llmRegistry
    ? await generateLlmBriefing(app.llmRegistry, data)
    : formatBriefing(data);
  const persona = await getActivePersona(app.db);
  const audio = await ttsService.synthesize(text, persona?.voiceId || undefined);
  if (!audio) return reply.status(500).send({ error: "TTS synthesis failed" });
  reply.header("Content-Type", "audio/mpeg");
  return reply.send(audio);
});
```

**Note:** `generateLlmBriefing` is currently not exported from `services/briefing.ts`. Export it.

---

## 2. Export `generateLlmBriefing`

**File:** `apps/agent-server/src/services/briefing.ts`

Change `generateLlmBriefing` from a private/unexported function to an exported function. It's currently used only by `sendDailyBriefing` but the new audio endpoint needs direct access to get the narrative text without triggering notification delivery.

---

## 3. ApiClient Method

**File:** `packages/api-client/src/client.ts`

Add:
```typescript
getBriefingAudio(): Promise<Blob> {
  return this.requestBlob("GET", "/api/briefing/audio");
}
```

The ApiClient currently only handles JSON responses. Add a `requestBlob` helper that returns the raw response as a `Blob` instead of parsing JSON. Pattern:

```typescript
private async requestBlob(method: string, path: string): Promise<Blob> {
  const url = `${this.baseUrl}${path}`;
  const headers: Record<string, string> = {};
  if (this.apiSecret) headers["Authorization"] = `Bearer ${this.apiSecret}`;
  const res = await fetch(url, { method, headers });
  if (!res.ok) throw new Error(`${method} ${path} failed: ${res.status}`);
  return res.blob();
}
```

---

## 4. Dashboard: HUD Briefing Card with Play Button

**File:** `apps/dashboard/src/routes/hud.tsx`

Enhance the existing briefing card:

1. Add a play/stop button next to the "Latest Briefing" title
2. On click "Play": fetch `/api/briefing/audio` via `apiClient.getBriefingAudio()`, create an `Audio` object from the blob URL, and play it
3. While playing, show a stop button. On click "Stop": pause audio and reset
4. Show a loading spinner while audio is being fetched/synthesized (this takes a few seconds)
5. Clean up the blob URL and audio object on unmount

State machine: `idle → loading → playing → idle`

```tsx
const [audioState, setAudioState] = useState<"idle" | "loading" | "playing">("idle");
const audioRef = useRef<HTMLAudioElement | null>(null);
const blobUrlRef = useRef<string | null>(null);

const handlePlay = async () => {
  setAudioState("loading");
  try {
    const blob = await apiClient.getBriefingAudio();
    const url = URL.createObjectURL(blob);
    blobUrlRef.current = url;
    const audio = new Audio(url);
    audioRef.current = audio;
    audio.onended = () => setAudioState("idle");
    audio.play();
    setAudioState("playing");
  } catch {
    setAudioState("idle");
  }
};

const handleStop = () => {
  audioRef.current?.pause();
  if (blobUrlRef.current) URL.revokeObjectURL(blobUrlRef.current);
  audioRef.current = null;
  blobUrlRef.current = null;
  setAudioState("idle");
};

// Cleanup on unmount
useEffect(() => {
  return () => {
    audioRef.current?.pause();
    if (blobUrlRef.current) URL.revokeObjectURL(blobUrlRef.current);
  };
}, []);
```

Button in the card header (next to `<CardTitle>`):
- `idle`: Play icon button (`Volume2` or `Play` from lucide)
- `loading`: `Loader2` spinning
- `playing`: `Square` (stop) icon button

---

## 5. Use LLM Narrative on Default Briefing Fetch

**File:** `apps/agent-server/src/routes/health.ts`

Currently `GET /api/briefing` (without `?send=true`) returns the static `formatBriefing()` output — bullet points, not a narrative. The HUD shows this text. For TTS to sound natural, the text should already be the LLM narrative.

Change the `send=false` path to also use `generateLlmBriefing` when the registry is available, while still returning the `data` object:

```typescript
// Before:
const text = formatBriefing(data);
return { sent: false, briefing: text, data };

// After:
const text = app.llmRegistry
  ? await generateLlmBriefing(app.llmRegistry, data)
  : formatBriefing(data);
return { sent: false, briefing: text, data };
```

This makes the HUD text nicer AND ensures the audio endpoint produces the same style of content.

---

## Files Modified

| File | Change |
|------|--------|
| `apps/agent-server/src/services/briefing.ts` | Export `generateLlmBriefing` |
| `apps/agent-server/src/routes/health.ts` | Add `GET /api/briefing/audio` endpoint; use LLM narrative on default briefing fetch |
| `packages/api-client/src/client.ts` | Add `requestBlob()` helper + `getBriefingAudio()` method |
| `apps/dashboard/src/routes/hud.tsx` | Add play/stop button + audio state to briefing card |

---

## Verification

1. **Build**: `npm run build` — all packages compile
2. **Tests**: `npm run test` — existing tests still pass
3. **Manual — audio endpoint**: `curl http://localhost:3100/api/briefing/audio -o briefing.mp3` — plays valid MP3
4. **Manual — HUD**: Open dashboard HUD, click play on briefing card → audio plays, stop button works
5. **Manual — no TTS**: With `ELEVENLABS_API_KEY` unset, play button should gracefully fail (no crash)
6. **Manual — narrative text**: HUD briefing card now shows conversational narrative instead of bullet points
