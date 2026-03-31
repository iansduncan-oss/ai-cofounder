import { screen } from "@testing-library/react";
import { VoicePage } from "@/routes/voice";
import { renderWithProviders } from "../test-utils";

vi.mock("@/hooks/use-stream-chat", () => ({
  useStreamChat: () => ({
    isStreaming: false,
    accumulatedText: "",
    toolCalls: [],
    thinkingMessage: null,
    error: null,
    conversationId: undefined,
    model: undefined,
    provider: undefined,
    plan: undefined,
    richCards: [],
    suggestions: [],
    sendMessage: vi.fn(),
    cancel: vi.fn(),
    reset: vi.fn(),
  }),
}));

vi.mock("@/hooks/use-speech-recognition", () => ({
  useSpeechRecognition: () => ({
    isSupported: true,
    isListening: false,
    transcript: "",
    startListening: vi.fn(),
    stopListening: vi.fn(),
    error: null,
  }),
}));

vi.mock("@/hooks/use-text-to-speech", () => ({
  useTextToSpeech: () => ({
    isSpeaking: false,
    isAvailable: true,
    speak: vi.fn(),
    stop: vi.fn(),
    autoSpeak: true,
    setAutoSpeak: vi.fn(),
  }),
}));

vi.mock("@/api/queries", () => ({
  useConversationMessages: vi.fn().mockReturnValue({ data: null }),
  useListPersonas: vi.fn().mockReturnValue({ data: { personas: [] } }),
  useActivePersona: vi.fn().mockReturnValue({ data: { persona: null } }),
}));

describe("VoicePage", () => {
  it("renders voice page with header and status", () => {
    renderWithProviders(<VoicePage />);
    expect(screen.getByText("Voice")).toBeInTheDocument();
    expect(screen.getAllByText(/Tap the ring or hold Space/).length).toBeGreaterThanOrEqual(1);
  });

  it("renders empty state when no messages", () => {
    renderWithProviders(<VoicePage />);
    expect(screen.getByText(/No messages yet/)).toBeInTheDocument();
  });

  it("renders start listening button", () => {
    renderWithProviders(<VoicePage />);
    expect(screen.getByLabelText("Start listening")).toBeInTheDocument();
  });

  it("renders new conversation button", () => {
    renderWithProviders(<VoicePage />);
    expect(screen.getByText("New")).toBeInTheDocument();
  });

  it("renders auto-speak toggle", () => {
    renderWithProviders(<VoicePage />);
    // Auto-speak is on by default in our mock, so Volume2 icon should render
    expect(screen.getByTitle("Disable auto-speak")).toBeInTheDocument();
  });
});
