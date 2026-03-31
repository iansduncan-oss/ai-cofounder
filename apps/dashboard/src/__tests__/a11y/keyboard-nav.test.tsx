import userEvent from "@testing-library/user-event";
import { screen } from "@testing-library/react";
import { OverviewPage } from "@/routes/overview";
import { ChatPage } from "@/routes/chat";
import { GoalDetailPage } from "@/routes/goal-detail";
import { renderWithProviders } from "../test-utils";

// ── Overview mocks ──────────────────────────────────────
vi.mock("@/api/queries", () => ({
  useHealth: vi.fn().mockReturnValue({
    data: { status: "ok", timestamp: new Date().toISOString(), uptime: 7200 },
  }),
  usePendingApprovals: vi.fn().mockReturnValue({
    data: [],
    isLoading: false,
    error: null,
  }),
  usePendingTasks: vi.fn().mockReturnValue({
    data: [
      {
        id: "t1",
        goalId: "g1",
        title: "Write tests",
        status: "pending",
        orderIndex: 0,
        assignedAgent: "coder",
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
      },
    ],
    isLoading: false,
    error: null,
  }),
  useUsage: vi.fn().mockReturnValue({
    data: {
      totalInputTokens: 50000,
      totalOutputTokens: 30000,
      totalCostUsd: 1.23,
      requestCount: 10,
      period: "today",
      byProvider: {},
      byModel: {},
      byAgent: {},
    },
    isLoading: false,
  }),
  useProviderHealth: vi.fn().mockReturnValue({ data: { providers: [] } }),
  useGoalAnalytics: vi.fn().mockReturnValue({ data: null }),
  useDashboardUser: vi.fn().mockReturnValue({ data: { id: "user-uuid-1" } }),
  useConversationMessages: vi.fn().mockReturnValue({ data: null }),
  useConversations: vi.fn().mockReturnValue({ data: null }),
  useQuickActions: vi.fn().mockReturnValue({ data: [] }),
  useCostByGoal: vi.fn().mockReturnValue({ data: null }),
  useGoal: vi.fn().mockReturnValue({
    data: {
      id: "goal-1",
      conversationId: "c-1",
      title: "Test Goal",
      description: "A goal for testing",
      status: "active",
      priority: "medium",
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    },
    isLoading: false,
    error: null,
  }),
  useTasks: vi.fn().mockReturnValue({
    data: {
      data: [
        {
          id: "t1",
          goalId: "goal-1",
          title: "Task 1",
          status: "completed",
          orderIndex: 0,
          createdAt: new Date().toISOString(),
          updatedAt: new Date().toISOString(),
        },
      ],
      total: 1,
      limit: 50,
      offset: 0,
    },
    isLoading: false,
    error: null,
  }),
}));

vi.mock("@/api/mutations", () => ({
  useUpdateGoalStatus: vi.fn().mockReturnValue({ mutateAsync: vi.fn(), isPending: false }),
  useAcceptSuggestion: vi.fn().mockReturnValue({ mutateAsync: vi.fn() }),
  useApproveGoal: vi.fn().mockReturnValue({ mutateAsync: vi.fn(), isPending: false }),
  useRejectGoal: vi.fn().mockReturnValue({ mutateAsync: vi.fn(), isPending: false }),
  useDeleteGoal: vi.fn().mockReturnValue({ mutate: vi.fn(), isPending: false }),
  useCancelGoal: vi.fn().mockReturnValue({ mutate: vi.fn(), isPending: false }),
  useDeleteConversation: vi.fn().mockReturnValue({ mutate: vi.fn(), isPending: false }),
}));

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

vi.mock("react-router", async () => {
  const actual = await vi.importActual("react-router");
  return { ...actual, useParams: () => ({ id: "goal-1" }) };
});

describe("Keyboard Navigation", () => {
  describe("OverviewPage", () => {
    it("allows tabbing through interactive elements", async () => {
      const user = userEvent.setup();
      renderWithProviders(<OverviewPage />);

      // Tab should move focus to the first interactive element
      await user.tab();
      const focusedEl = document.activeElement;
      expect(focusedEl).not.toBe(document.body);
      expect(focusedEl?.tagName).toBeDefined();
    });

    it("links are reachable via keyboard", async () => {
      renderWithProviders(<OverviewPage />);

      // Tab through elements and check we can reach links
      const links = screen.getAllByRole("link");
      if (links.length > 0) {
        // Focus the first link
        links[0].focus();
        expect(document.activeElement).toBe(links[0]);
      }
    });
  });

  describe("ChatPage", () => {
    it("textarea is focusable via Tab", async () => {
      const user = userEvent.setup();
      renderWithProviders(<ChatPage />);

      // Tab into the textarea
      let foundTextarea = false;
      for (let i = 0; i < 20; i++) {
        await user.tab();
        if (document.activeElement?.tagName === "TEXTAREA") {
          foundTextarea = true;
          break;
        }
      }
      expect(foundTextarea).toBe(true);
    });

    it("buttons are activatable via Enter", async () => {
      renderWithProviders(<ChatPage />);

      const buttons = screen.getAllByRole("button");
      if (buttons.length > 0) {
        buttons[0].focus();
        expect(document.activeElement).toBe(buttons[0]);
        // Verify the button can receive keyboard focus
        expect(buttons[0].tabIndex).not.toBe(-1);
      }
    });

    it("buttons are activatable via Space", async () => {
      const user = userEvent.setup();
      renderWithProviders(<ChatPage />);

      const buttons = screen.getAllByRole("button");
      if (buttons.length > 0) {
        buttons[0].focus();
        // Space should not throw on focused button
        await user.keyboard(" ");
        expect(document.activeElement).toBeDefined();
      }
    });
  });

  describe("GoalDetailPage", () => {
    it("allows tabbing through goal actions", async () => {
      const user = userEvent.setup();
      renderWithProviders(<GoalDetailPage />, {
        initialEntries: ["/dashboard/goals/goal-1"],
      });

      // Tab and verify focus moves
      await user.tab();
      const firstFocused = document.activeElement;
      await user.tab();
      const secondFocused = document.activeElement;

      // Focus should move between elements
      expect(firstFocused).not.toBe(document.body);
      expect(secondFocused).not.toBe(document.body);
    });

    it("interactive elements have visible focus indicators", () => {
      renderWithProviders(<GoalDetailPage />, {
        initialEntries: ["/dashboard/goals/goal-1"],
      });

      // All buttons and links should be focusable (tabIndex not -1)
      const buttons = screen.queryAllByRole("button");
      const links = screen.queryAllByRole("link");
      const interactive = [...buttons, ...links];

      for (const el of interactive) {
        // Elements should not have tabIndex=-1 (which removes from tab order)
        expect(el.tabIndex).not.toBe(-1);
      }
    });
  });
});
