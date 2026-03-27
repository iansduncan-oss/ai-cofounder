import { axe } from "vitest-axe";
import { ChatPage } from "@/routes/chat";
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

vi.mock("@/api/queries", () => ({
  useDashboardUser: vi.fn().mockReturnValue({ data: { id: "user-uuid-1" } }),
  useConversationMessages: vi.fn().mockReturnValue({ data: null }),
  useConversations: vi.fn().mockReturnValue({ data: null }),
  useQuickActions: vi.fn().mockReturnValue({ data: [] }),
}));

vi.mock("@/api/mutations", () => ({
  useAcceptSuggestion: vi.fn().mockReturnValue({ mutateAsync: vi.fn() }),
  useDeleteConversation: vi.fn().mockReturnValue({ mutate: vi.fn(), isPending: false }),
}));

vi.mock("@/hooks/use-speech-recognition", () => ({
  useSpeechRecognition: () => ({
    isListening: false,
    transcript: "",
    isSupported: false,
    start: vi.fn(),
    stop: vi.fn(),
    reset: vi.fn(),
  }),
}));

vi.mock("@/hooks/use-text-to-speech", () => ({
  useTextToSpeech: () => ({
    isSpeaking: false,
    isLoading: false,
    speak: vi.fn(),
    stop: vi.fn(),
  }),
}));

describe("ChatPage a11y", () => {
  it("has no accessibility violations in empty conversation state", async () => {
    const { container } = renderWithProviders(<ChatPage />);
    const results = await axe(container);
    expect(results).toHaveNoViolations();
  });

  it("has no accessibility violations with messages rendered", async () => {
    // Provide conversations data so the sidebar renders with content
    const { useConversationMessages } = await import("@/api/queries");
    vi.mocked(useConversationMessages).mockReturnValue({
      data: [
        { id: "m1", role: "user", content: "Hello", createdAt: new Date().toISOString() },
        { id: "m2", role: "assistant", content: "Hi there!", createdAt: new Date().toISOString() },
      ],
    } as unknown as ReturnType<typeof useConversationMessages>);

    const { container } = renderWithProviders(<ChatPage />);
    const results = await axe(container);
    expect(results).toHaveNoViolations();
  });
});
