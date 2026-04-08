import { createLogger, optionalEnv } from "@ai-cofounder/shared";

const logger = createLogger("tts");

export interface TTSConfig {
  apiKey: string;
  voiceId: string;
  modelId: string;
  edgeTtsUrl: string;
  edgeTtsVoice: string;
}

export class TTSService {
  private apiKey: string;
  private voiceId: string;
  private modelId: string;
  private edgeTtsUrl: string;
  private edgeTtsVoice: string;

  constructor(config: TTSConfig) {
    this.apiKey = config.apiKey;
    this.voiceId = config.voiceId;
    this.modelId = config.modelId;
    this.edgeTtsUrl = config.edgeTtsUrl;
    this.edgeTtsVoice = config.edgeTtsVoice;
  }

  isConfigured(): boolean {
    return !!(this.edgeTtsUrl || (this.apiKey && this.voiceId));
  }

  private hasEdgeTts(): boolean {
    return !!this.edgeTtsUrl;
  }

  private hasElevenLabs(): boolean {
    return !!(this.apiKey && this.voiceId);
  }

  /** Clean markdown/code for speech synthesis */
  private cleanText(text: string): string {
    const cleaned = text
      .replace(/```[\s\S]*?```/g, " (code block) ")
      .replace(/[*_#`~]/g, "")
      .replace(/\[([^\]]+)\]\([^)]+\)/g, "$1")
      .replace(/\n{2,}/g, ". ")
      .replace(/\n/g, " ")
      .trim();
    if (!cleaned) return "";
    return cleaned.length > 3000 ? cleaned.slice(0, 3000) + "..." : cleaned;
  }

  /**
   * Generate speech via Edge TTS (free, self-hosted).
   * Returns an MP3 audio buffer.
   */
  async synthesizeEdgeTts(text: string, voice?: string): Promise<Buffer | null> {
    const cleanText = this.cleanText(text);
    if (!cleanText) return null;

    const ttsVoice = voice || this.edgeTtsVoice;

    try {
      const res = await fetch(`${this.edgeTtsUrl}/tts`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          text: cleanText,
          voice: ttsVoice,
          rate: "-5%",
          pitch: "-2Hz",
        }),
      });

      if (!res.ok) {
        const errorText = await res.text();
        logger.error({ status: res.status, error: errorText }, "Edge TTS error");
        return null;
      }

      const arrayBuffer = await res.arrayBuffer();
      logger.info({ textLength: cleanText.length, audioBytes: arrayBuffer.byteLength, voice: ttsVoice }, "Edge TTS generated");
      return Buffer.from(arrayBuffer);
    } catch (err) {
      logger.error({ err }, "Edge TTS synthesis failed");
      return null;
    }
  }

  /**
   * Generate speech audio. Tries Edge TTS first (free), falls back to ElevenLabs.
   * Returns an MP3 audio buffer.
   */
  async synthesize(text: string, overrideVoiceId?: string): Promise<Buffer | null> {
    if (!this.isConfigured()) return null;

    // Try Edge TTS first (free)
    if (this.hasEdgeTts()) {
      const result = await this.synthesizeEdgeTts(text);
      if (result) return result;
      logger.warn("Edge TTS failed, attempting ElevenLabs fallback");
    }

    // Fall back to ElevenLabs if configured
    if (!this.hasElevenLabs()) return null;
    return this.synthesizeElevenLabs(text, overrideVoiceId);
  }

  /**
   * Generate speech audio via ElevenLabs API (paid fallback).
   * Returns an MP3 audio buffer.
   */
  async synthesizeElevenLabs(text: string, overrideVoiceId?: string): Promise<Buffer | null> {
    const voice = overrideVoiceId || this.voiceId;
    const truncated = this.cleanText(text);
    if (!truncated) return null;

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
              stability: 0.75,
              similarity_boost: 0.80,
              style: 0.10,
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
      logger.info({ textLength: truncated.length, audioBytes: arrayBuffer.byteLength }, "ElevenLabs TTS generated");
      return Buffer.from(arrayBuffer);
    } catch (err) {
      logger.error({ err }, "ElevenLabs TTS synthesis failed");
      return null;
    }
  }

  /**
   * Stream speech audio from text via ElevenLabs streaming API.
   * Returns a ReadableStream of audio chunks.
   */
  async synthesizeStream(text: string, overrideVoiceId?: string): Promise<ReadableStream<Uint8Array> | null> {
    if (!this.hasElevenLabs()) return null;

    const voice = overrideVoiceId || this.voiceId;
    const truncated = this.cleanText(text);
    if (!truncated) return null;

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
              stability: 0.75,
              similarity_boost: 0.80,
              style: 0.10,
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
    voiceId: optionalEnv("ELEVENLABS_VOICE_ID", "pNInz6obpgDQGcFmaJgB"),
    modelId: optionalEnv("ELEVENLABS_MODEL_ID", "eleven_turbo_v2_5"),
    edgeTtsUrl: optionalEnv("EDGE_TTS_URL", ""),
    edgeTtsVoice: optionalEnv("EDGE_TTS_VOICE", "en-GB-RyanNeural"),
  });
}
