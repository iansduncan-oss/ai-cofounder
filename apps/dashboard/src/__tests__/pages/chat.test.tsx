import { screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { ChatPage } from "@/routes/chat";
import { renderWithProviders } from "../test-utils";

// Mock hooks
const mockSendMessage = vi.fn();
const mockCancel = vi.fn();
const mockReset = vi.fn();

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
    sendMessage: mockSendMessage,
    cancel: mockCancel,
    reset: mockReset,
  }),
}));

vi.mock("@/api/queries", () => ({
  useDashboardUser: vi.fn().mockReturnValue({ data: { id: "user-uuid-1" } }),
  useConversationMessages: vi.fn().mockReturnValue({ data: null }),
  useConversations: vi.fn().mockReturnValue({ data: null }),
  useQuickActions: vi.fn().mockReturnValue({ data: [] }),
}));

describe("ChatPage", () => {
  beforeEach(() => {
    mockSendMessage.mockReset();
    mockCancel.mockReset();
    mockReset.mockReset();
  });

  it("renders chat page with empty state", () => {
    renderWithProviders(<ChatPage />);
    expect(screen.getByText("What can I help with?")).toBeInTheDocument();
  });

  it("renders input textarea", () => {
    renderWithProviders(<ChatPage />);
    expect(screen.getByPlaceholderText(/Type a message/)).toBeInTheDocument();
  });

  it("renders send button", () => {
    renderWithProviders(<ChatPage />);
    expect(screen.getByLabelText("Send message")).toBeInTheDocument();
  });

  it("disables send button when input is empty", () => {
    renderWithProviders(<ChatPage />);
    expect(screen.getByLabelText("Send message")).toBeDisabled();
  });

  it("enables send button when input has text", async () => {
    renderWithProviders(<ChatPage />);
    const textarea = screen.getByPlaceholderText(/Type a message/);
    await userEvent.type(textarea, "Hello");
    expect(screen.getByLabelText("Send message")).not.toBeDisabled();
  });

  it("calls sendMessage on Enter", async () => {
    renderWithProviders(<ChatPage />);
    const textarea = screen.getByPlaceholderText(/Type a message/);

    await userEvent.type(textarea, "Hello{enter}");

    expect(mockSendMessage).toHaveBeenCalledWith("Hello", undefined, "user-uuid-1");
  });

  it("does not send on Shift+Enter", async () => {
    renderWithProviders(<ChatPage />);
    const textarea = screen.getByPlaceholderText(/Type a message/);

    await userEvent.type(textarea, "Hello{shift>}{enter}{/shift}");

    expect(mockSendMessage).not.toHaveBeenCalled();
  });

  it("clears input after sending", async () => {
    renderWithProviders(<ChatPage />);
    const textarea = screen.getByPlaceholderText(/Type a message/) as HTMLTextAreaElement;

    await userEvent.type(textarea, "Hello{enter}");

    expect(textarea.value).toBe("");
  });

  it("shows keyboard shortcut hints", () => {
    renderWithProviders(<ChatPage />);
    expect(screen.getByText(/Cmd\+N new chat/)).toBeInTheDocument();
  });
});
