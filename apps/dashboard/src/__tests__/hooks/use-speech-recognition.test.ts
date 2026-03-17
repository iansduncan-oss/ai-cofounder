import { renderHook, act } from "@testing-library/react";

// Mock SpeechRecognition as a class constructor
class MockSpeechRecognition {
  continuous = false;
  interimResults = false;
  lang = "";
  onresult: ((event: { results: unknown }) => void) | null = null;
  onerror: ((event: { error: string }) => void) | null = null;
  onend: (() => void) | null = null;
  start = vi.fn();
  stop = vi.fn();
  abort = vi.fn();
  addEventListener = vi.fn();
  removeEventListener = vi.fn();
  dispatchEvent = vi.fn();
}

let mockInstance: MockSpeechRecognition;

beforeEach(() => {
  mockInstance = new MockSpeechRecognition();

  // Use a class that returns our tracked instance
  const MockConstructor = class {
    constructor() {
      Object.assign(this, mockInstance);
      // Ensure the ref points to THIS object (the one the hook stores)
      mockInstance = this as unknown as MockSpeechRecognition;
    }
  };
  Object.assign(MockConstructor.prototype, {
    start: mockInstance.start,
    stop: mockInstance.stop,
    abort: mockInstance.abort,
  });

  window.SpeechRecognition = MockConstructor as unknown as typeof window.SpeechRecognition;
  window.webkitSpeechRecognition = undefined;
});

afterEach(() => {
  window.SpeechRecognition = undefined;
  window.webkitSpeechRecognition = undefined;
});

async function importHook() {
  vi.resetModules();
  const mod = await import("@/hooks/use-speech-recognition");
  return mod.useSpeechRecognition;
}

describe("useSpeechRecognition", () => {
  it("reports isSupported=true when SpeechRecognition exists", async () => {
    const useSpeechRecognition = await importHook();
    const { result } = renderHook(() => useSpeechRecognition());
    expect(result.current.isSupported).toBe(true);
  });

  it("reports isSupported=false when SpeechRecognition is absent", async () => {
    window.SpeechRecognition = undefined;
    const useSpeechRecognition = await importHook();
    const { result } = renderHook(() => useSpeechRecognition());
    expect(result.current.isSupported).toBe(false);
  });

  it("starts listening and calls recognition.start()", async () => {
    const useSpeechRecognition = await importHook();
    const { result } = renderHook(() => useSpeechRecognition());

    expect(result.current.isListening).toBe(false);

    act(() => {
      result.current.startListening();
    });

    expect(result.current.isListening).toBe(true);
    expect(mockInstance.start).toHaveBeenCalled();
  });

  it("stops listening and calls recognition.stop()", async () => {
    const useSpeechRecognition = await importHook();
    const { result } = renderHook(() => useSpeechRecognition());

    act(() => {
      result.current.startListening();
    });
    expect(result.current.isListening).toBe(true);

    act(() => {
      result.current.stopListening();
    });
    expect(result.current.isListening).toBe(false);
    expect(mockInstance.stop).toHaveBeenCalled();
  });

  it("accumulates transcript from onresult", async () => {
    const useSpeechRecognition = await importHook();
    const { result } = renderHook(() => useSpeechRecognition());

    act(() => {
      result.current.startListening();
    });

    act(() => {
      mockInstance.onresult?.({
        results: {
          length: 2,
          0: { 0: { transcript: "hello ", confidence: 0.9 }, length: 1, isFinal: true },
          1: { 0: { transcript: "world", confidence: 0.95 }, length: 1, isFinal: true },
        },
      });
    });

    expect(result.current.transcript).toBe("hello world");
  });

  it("sets error on non-aborted errors", async () => {
    vi.useFakeTimers();
    const useSpeechRecognition = await importHook();
    const { result } = renderHook(() => useSpeechRecognition());

    act(() => {
      result.current.startListening();
    });

    act(() => {
      mockInstance.onerror?.({ error: "not-allowed" });
    });

    expect(result.current.error).toBe("not-allowed");
    expect(result.current.isListening).toBe(false);

    // Error clears after 3s
    act(() => {
      vi.advanceTimersByTime(3000);
    });
    expect(result.current.error).toBeNull();

    vi.useRealTimers();
  });

  it("ignores aborted errors (no error state)", async () => {
    const useSpeechRecognition = await importHook();
    const { result } = renderHook(() => useSpeechRecognition());

    act(() => {
      result.current.startListening();
    });

    act(() => {
      mockInstance.onerror?.({ error: "aborted" });
    });

    expect(result.current.error).toBeNull();
    expect(result.current.isListening).toBe(false);
  });

  it("calls stop on unmount", async () => {
    const useSpeechRecognition = await importHook();
    const { unmount } = renderHook(() => useSpeechRecognition());

    unmount();
    expect(mockInstance.stop).toHaveBeenCalled();
  });

  it("clears transcript on startListening", async () => {
    const useSpeechRecognition = await importHook();
    const { result } = renderHook(() => useSpeechRecognition());

    act(() => {
      result.current.startListening();
    });
    act(() => {
      mockInstance.onresult?.({
        results: {
          length: 1,
          0: { 0: { transcript: "old text", confidence: 0.9 }, length: 1, isFinal: true },
        },
      });
    });
    expect(result.current.transcript).toBe("old text");

    // Trigger onend to stop, then restart
    act(() => {
      mockInstance.onend?.();
    });
    act(() => {
      result.current.startListening();
    });
    expect(result.current.transcript).toBe("");
  });
});
