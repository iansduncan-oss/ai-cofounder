import { renderHook, act, waitFor } from "@testing-library/react";

// Track Audio instances
let mockAudioInstances: Array<{
  play: ReturnType<typeof vi.fn>;
  pause: ReturnType<typeof vi.fn>;
  onended: (() => void) | null;
  onerror: (() => void) | null;
}>;

function setupSpeechSynthesis() {
  Object.defineProperty(window, "speechSynthesis", {
    writable: true,
    configurable: true,
    value: {
      speak: vi.fn(),
      cancel: vi.fn(),
      getVoices: vi.fn().mockReturnValue([]),
    },
  });
}

beforeEach(() => {
  mockAudioInstances = [];

  // Vitest 4.x requires constructors to use class/function, not arrow fns
  globalThis.Audio = class MockAudio {
    play = vi.fn().mockResolvedValue(undefined);
    pause = vi.fn();
    onended: (() => void) | null = null;
    onerror: (() => void) | null = null;
    constructor() {
      mockAudioInstances.push(this as unknown as (typeof mockAudioInstances)[0]);
    }
  } as unknown as typeof Audio;

  globalThis.URL.createObjectURL = vi.fn().mockReturnValue("blob:mock-url");
  globalThis.URL.revokeObjectURL = vi.fn();

  setupSpeechSynthesis();

  globalThis.SpeechSynthesisUtterance = class {
    text = "";
    rate = 1;
    pitch = 1;
    voice: SpeechSynthesisVoice | null = null;
    onstart: (() => void) | null = null;
    onend: (() => void) | null = null;
    onerror: (() => void) | null = null;
    constructor(text?: string) {
      if (text) this.text = text;
    }
  } as unknown as typeof SpeechSynthesisUtterance;
});

/**
 * Import hook fresh and render it.
 * Waits for the availability check effect to settle.
 */
async function setupHook(ttsEndpointOk: boolean) {
  const fetchMock = vi.fn().mockImplementation(() => {
    if (ttsEndpointOk) {
      return Promise.resolve({
        ok: true,
        blob: () => Promise.resolve(new Blob(["audio-data"])),
      });
    }
    return Promise.resolve({ ok: false });
  });
  globalThis.fetch = fetchMock;

  vi.resetModules();
  const { useTextToSpeech } = await import("@/hooks/use-text-to-speech");
  const hookResult = renderHook(() => useTextToSpeech());

  // Flush the availability-check useEffect
  await act(async () => {
    // Let microtasks (fetch promises + setState) complete
    await new Promise((r) => setTimeout(r, 0));
  });

  return { hookResult, fetchMock };
}

describe("useTextToSpeech", () => {
  describe("isAvailable", () => {
    it("is true when ElevenLabs TTS endpoint responds ok", async () => {
      // Remove speechSynthesis to isolate ttsAvailable
      Object.defineProperty(window, "speechSynthesis", {
        writable: true, configurable: true, value: undefined,
      });
      const { hookResult } = await setupHook(true);
      expect(hookResult.result.current.isAvailable).toBe(true);
    });

    it("is true via speechSynthesis fallback when TTS endpoint fails", async () => {
      const { hookResult } = await setupHook(false);
      expect(hookResult.result.current.isAvailable).toBe(true);
    });

    it("is false when neither TTS nor speechSynthesis available", async () => {
      Object.defineProperty(window, "speechSynthesis", {
        writable: true, configurable: true, value: undefined,
      });
      const { hookResult } = await setupHook(false);
      expect(hookResult.result.current.isAvailable).toBe(false);
    });
  });

  describe("speak — ElevenLabs path", () => {
    async function setupElevenLabs() {
      // Remove speechSynthesis so isAvailable purely reflects ttsAvailable
      Object.defineProperty(window, "speechSynthesis", {
        writable: true, configurable: true, value: undefined,
      });
      const result = await setupHook(true);
      // Wait for ttsAvailable state to be set via the availability check
      await waitFor(() => {
        expect(result.hookResult.result.current.isAvailable).toBe(true);
      });
      // Restore speechSynthesis for stop() behavior
      setupSpeechSynthesis();
      return result;
    }

    it("fetches TTS endpoint and plays audio", async () => {
      const { hookResult, fetchMock } = await setupElevenLabs();

      await act(async () => {
        await hookResult.result.current.speak("Hello world");
      });

      // First call is the availability check, second is speak
      expect(fetchMock).toHaveBeenCalledTimes(2);
      expect(fetchMock).toHaveBeenLastCalledWith("/voice/tts", expect.objectContaining({
        method: "POST",
        body: JSON.stringify({ text: "Hello world" }),
      }));
      expect(mockAudioInstances.length).toBe(1);
      expect(mockAudioInstances[0].play).toHaveBeenCalled();
    });

    it("sets isSpeaking=false when audio ends", async () => {
      const { hookResult } = await setupElevenLabs();

      await act(async () => {
        await hookResult.result.current.speak("test");
      });

      expect(hookResult.result.current.isSpeaking).toBe(true);

      act(() => {
        mockAudioInstances[0].onended?.();
      });

      expect(hookResult.result.current.isSpeaking).toBe(false);
    });

    it("falls back to browser TTS when speak fetch fails", async () => {
      const { hookResult, fetchMock } = await setupElevenLabs();

      // Make subsequent fetches fail
      fetchMock.mockResolvedValue({ ok: false });

      await act(async () => {
        await hookResult.result.current.speak("fallback text");
      });

      expect(window.speechSynthesis.speak).toHaveBeenCalled();
    });
  });

  describe("speak — browser fallback path", () => {
    it("uses speechSynthesis when TTS endpoint unavailable", async () => {
      const { hookResult } = await setupHook(false);

      await act(async () => {
        await hookResult.result.current.speak("browser speech");
      });

      expect(window.speechSynthesis.cancel).toHaveBeenCalled();
      expect(window.speechSynthesis.speak).toHaveBeenCalled();
    });
  });

  describe("stop", () => {
    it("pauses audio and cancels synthesis", async () => {
      // Need ElevenLabs path to create Audio instance
      Object.defineProperty(window, "speechSynthesis", {
        writable: true, configurable: true, value: undefined,
      });
      const { hookResult } = await setupHook(true);
      await waitFor(() => {
        expect(hookResult.result.current.isAvailable).toBe(true);
      });
      setupSpeechSynthesis();

      await act(async () => {
        await hookResult.result.current.speak("playing");
      });

      expect(mockAudioInstances.length).toBeGreaterThan(0);

      act(() => {
        hookResult.result.current.stop();
      });

      expect(mockAudioInstances[0].pause).toHaveBeenCalled();
      expect(window.speechSynthesis.cancel).toHaveBeenCalled();
      expect(hookResult.result.current.isSpeaking).toBe(false);
    });
  });

  describe("autoSpeak", () => {
    it("defaults to false", async () => {
      const { hookResult } = await setupHook(true);
      expect(hookResult.result.current.autoSpeak).toBe(false);
    });

    it("reads from localStorage", async () => {
      localStorage.setItem("ai-cofounder-autospeak", "true");
      const { hookResult } = await setupHook(true);
      expect(hookResult.result.current.autoSpeak).toBe(true);
    });

    it("persists to localStorage when set", async () => {
      const { hookResult } = await setupHook(true);

      act(() => {
        hookResult.result.current.setAutoSpeak(true);
      });

      expect(hookResult.result.current.autoSpeak).toBe(true);
      expect(localStorage.setItem).toHaveBeenCalledWith(
        "ai-cofounder-autospeak",
        "true",
      );
    });
  });
});
