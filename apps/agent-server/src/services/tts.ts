import { createLogger, optionalEnv } from "@ai-cofounder/shared";

const logger = createLogger("tts");

export interface TTSConfig {
  apiKey: string;
  voiceId: string;
  modelId: string;
}

export class TTSService {
  private apiKey: string;
  private voiceId: string;
  private modelId: string;

  constructor(config: TTSConfig) {
    this.apiKey = config.apiKey;
    this.voiceId = config.voiceId;
    this.modelId = config.modelId;
  }

  isConfigured(): boolean {
    return !!(this.apiKey && this.voiceId);
  }

  /**
   * Generate speech audio from text via ElevenLabs API.
   * Returns an MP3 audio buffer.
   */
  async synthesize(text: string, overrideVoiceId?: string): Promise<Buffer | null> {
    if (!this.isConfigured()) return null;

    const voice = overrideVoiceId || this.voiceId;

    // Clean markdown for speech
    const cleanText = text
      .replace(/```[\s\S]*?```/g, " (code block) ")
      .replace(/[*_#`~]/g, "")
      .replace(/\[([^\]]+)\]\([^)]+\)/g, "$1")
      .replace(/\n{2,}/g, ". ")
      .replace(/\n/g, " ")
      .trim();

    if (!cleanText) return null;

    // Truncate very long text to avoid excessive API costs
    const truncated = cleanText.length > 3000 ? cleanText.slice(0, 3000) + "..." : cleanText;

    try {
      const res = await fetch(
        `https://api.elevenlabs.io/v1/text-to-speech/${voice}`,
        {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            "xi-api-key": this.apiKey,
          },
          body: JSON.stringify({
            text: truncated,
            model_id: this.modelId,
            voice_settings: {
              stability: 0.6,
              similarity_boost: 0.85,
              style: 0.15,
            },
          }),
        },
      );

      if (!res.ok) {
        const errorText = await res.text();
        logger.error({ status: res.status, error: errorText }, "ElevenLabs TTS error");
        return null;
      }

      const arrayBuffer = await res.arrayBuffer();
      logger.info({ textLength: truncated.length, audioBytes: arrayBuffer.byteLength }, "TTS generated");
      return Buffer.from(arrayBuffer);
    } catch (err) {
      logger.error({ err }, "TTS synthesis failed");
      return null;
    }
  }

  /**
   * Stream speech audio from text via ElevenLabs streaming API.
   * Returns a ReadableStream of audio chunks.
   */
  async synthesizeStream(text: string, overrideVoiceId?: string): Promise<ReadableStream<Uint8Array> | null> {
    if (!this.isConfigured()) return null;

    const voice = overrideVoiceId || this.voiceId;

    const cleanText = text
      .replace(/```[\s\S]*?```/g, " (code block) ")
      .replace(/[*_#`~]/g, "")
      .replace(/\[([^\]]+)\]\([^)]+\)/g, "$1")
      .replace(/\n{2,}/g, ". ")
      .replace(/\n/g, " ")
      .trim();

    if (!cleanText) return null;

    const truncated = cleanText.length > 3000 ? cleanText.slice(0, 3000) + "..." : cleanText;

    try {
      const res = await fetch(
        `https://api.elevenlabs.io/v1/text-to-speech/${voice}/stream`,
        {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            "xi-api-key": this.apiKey,
          },
          body: JSON.stringify({
            text: truncated,
            model_id: this.modelId,
            voice_settings: {
              stability: 0.6,
              similarity_boost: 0.85,
              style: 0.15,
            },
          }),
        },
      );

      if (!res.ok || !res.body) {
        logger.error({ status: res.status }, "ElevenLabs streaming TTS error");
        return null;
      }

      return res.body;
    } catch (err) {
      logger.error({ err }, "TTS streaming failed");
      return null;
    }
  }
}

export function createTTSService(): TTSService {
  return new TTSService({
    apiKey: optionalEnv("ELEVENLABS_API_KEY", ""),
    voiceId: optionalEnv("ELEVENLABS_VOICE_ID", "pNInz6obpgDQGcFmaJgB"), // "Adam" default
    modelId: optionalEnv("ELEVENLABS_MODEL_ID", "eleven_turbo_v2_5"),
  });
}
