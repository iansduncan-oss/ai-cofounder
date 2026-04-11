import userEvent from "@testing-library/user-event";
import { screen, waitFor } from "@testing-library/react";
import { renderWithProviders } from "./test-utils";

// ── Shared mocks ────────────────────────────────────────

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
  useGoals: vi.fn().mockReturnValue({
    data: {
      data: [
        {
          id: "goal-1",
          conversationId: "c-1",
          title: "Build auth system",
          description: "Implement user authentication",
          status: "active",
          priority: "high",
          createdAt: new Date().toISOString(),
          updatedAt: new Date().toISOString(),
        },
        {
          id: "goal-2",
          conversationId: "c-1",
          title: "Add unit tests",
          description: "Coverage for all modules",
          status: "proposed",
          priority: "medium",
          createdAt: new Date().toISOString(),
          updatedAt: new Date().toISOString(),
        },
      ],
      total: 2,
      limit: 50,
      offset: 0,
    },
    isLoading: false,
    error: null,
  }),
  useGlobalSearch: vi.fn().mockReturnValue({
    data: null,
    isFetching: false,
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
  useCreateGoal: vi.fn().mockReturnValue({ mutate: vi.fn(), isPending: false }),
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

// ── Imports (after mocks) ───────────────────────────────
import { ChatPage } from "@/routes/chat";
import { GoalsPage } from "@/routes/goals";
import { GoalDetailPage } from "@/routes/goal-detail";
import { Dialog, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { useState } from "react";

// ── Helpers ─────────────────────────────────────────────

/** Count how many Tab presses it takes to reach an element (max 30). */
async function tabsToReach(
  user: ReturnType<typeof userEvent.setup>,
  predicate: (el: Element | null) => boolean,
  maxTabs = 30,
): Promise<number> {
  for (let i = 1; i <= maxTabs; i++) {
    await user.tab();
    if (predicate(document.activeElement)) return i;
  }
  return -1;
}

// ── Dialog test wrapper ─────────────────────────────────

function DialogTestHarness() {
  const [open, setOpen] = useState(false);

  return (
    <div>
      <button data-testid="trigger" onClick={() => setOpen(true)}>
        Open Dialog
      </button>
      <button data-testid="outside">Outside button</button>
      <Dialog open={open} onClose={() => setOpen(false)}>
        <DialogHeader>
          <DialogTitle>Test Dialog</DialogTitle>
        </DialogHeader>
        <Input data-testid="dialog-input" placeholder="Type here" />
        <DialogFooter>
          <Button data-testid="dialog-cancel" onClick={() => setOpen(false)}>
            Cancel
          </Button>
          <Button data-testid="dialog-confirm">Confirm</Button>
        </DialogFooter>
      </Dialog>
    </div>
  );
}

// ── Tests ───────────────────────────────────────────────

describe("Keyboard Navigation", () => {
  // ── Dialog / Modal ──────────────────────────────────

  describe("Dialog focus management", () => {
    it("auto-focuses first focusable element when dialog opens", async () => {
      const user = userEvent.setup();
      renderWithProviders(<DialogTestHarness />);

      await user.click(screen.getByTestId("trigger"));

      // Dialog should auto-focus the first focusable element (the input)
      await waitFor(() => {
        expect(document.activeElement).toBe(screen.getByTestId("dialog-input"));
      });
    });

    it("traps focus within dialog — Tab wraps from last to first", async () => {
      const user = userEvent.setup();
      renderWithProviders(<DialogTestHarness />);

      await user.click(screen.getByTestId("trigger"));
      await waitFor(() => {
        expect(screen.getByRole("dialog")).toBeInTheDocument();
      });

      // Tab through: input -> cancel -> confirm -> wraps back to input
      const dialogInput = screen.getByTestId("dialog-input");
      const cancelBtn = screen.getByTestId("dialog-cancel");
      const confirmBtn = screen.getByTestId("dialog-confirm");

      // Start at input (auto-focused), tab to cancel
      await user.tab();
      expect(document.activeElement).toBe(cancelBtn);

      // Tab to confirm
      await user.tab();
      expect(document.activeElement).toBe(confirmBtn);

      // Tab should wrap back to first focusable (input)
      await user.tab();
      expect(document.activeElement).toBe(dialogInput);
    });

    it("traps focus within dialog — Shift+Tab wraps from first to last", async () => {
      const user = userEvent.setup();
      renderWithProviders(<DialogTestHarness />);

      await user.click(screen.getByTestId("trigger"));
      await waitFor(() => {
        expect(screen.getByTestId("dialog-input")).toHaveFocus();
      });

      // Shift+Tab from first element should wrap to last
      await user.tab({ shift: true });
      expect(document.activeElement).toBe(screen.getByTestId("dialog-confirm"));
    });

    it("closes dialog on Escape key", async () => {
      const user = userEvent.setup();
      renderWithProviders(<DialogTestHarness />);

      await user.click(screen.getByTestId("trigger"));
      await waitFor(() => {
        expect(screen.getByRole("dialog")).toBeInTheDocument();
      });

      await user.keyboard("{Escape}");
      expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
    });

    it("focus does not leak outside dialog while open", async () => {
      const user = userEvent.setup();
      renderWithProviders(<DialogTestHarness />);

      await user.click(screen.getByTestId("trigger"));
      await waitFor(() => {
        expect(screen.getByRole("dialog")).toBeInTheDocument();
      });

      // Tab many times — focus should never reach the "outside" button
      for (let i = 0; i < 10; i++) {
        await user.tab();
        expect(document.activeElement).not.toBe(screen.getByTestId("outside"));
      }
    });
  });

  // ── Chat Page ───────────────────────────────────────

  describe("ChatPage keyboard interaction", () => {
    it("textarea is reachable by tabbing", async () => {
      const user = userEvent.setup();
      renderWithProviders(<ChatPage />);

      const tabs = await tabsToReach(user, (el) => el?.tagName === "TEXTAREA");
      expect(tabs).toBeGreaterThan(0);
    });

    it("send button is reachable by tabbing after textarea", async () => {
      const user = userEvent.setup();
      renderWithProviders(<ChatPage />);

      // Tab to textarea first
      await tabsToReach(user, (el) => el?.tagName === "TEXTAREA");

      // Type something so send button becomes enabled
      await user.type(document.activeElement!, "Hello");

      // Tab forward to find the send button
      const tabs = await tabsToReach(
        user,
        (el) => el?.getAttribute("aria-label") === "Send message",
      );
      expect(tabs).toBeGreaterThan(0);
    });

    it("Enter key in textarea triggers message send", async () => {
      renderWithProviders(<ChatPage />);
      const textarea = screen.getByPlaceholderText(/Type a message/) as HTMLTextAreaElement;

      await userEvent.type(textarea, "Hello{enter}");

      // After Enter, textarea should be cleared (message was sent)
      expect(textarea.value).toBe("");
    });

    it("Shift+Enter does not send (allows multiline input)", async () => {
      renderWithProviders(<ChatPage />);
      const textarea = screen.getByPlaceholderText(/Type a message/) as HTMLTextAreaElement;

      await userEvent.type(textarea, "Hello{shift>}{enter}{/shift}");

      // Textarea should still contain the text (message was not sent)
      expect(textarea.value).toContain("Hello");
    });

    it("all buttons are keyboard-accessible (tabIndex not -1)", () => {
      renderWithProviders(<ChatPage />);
      const buttons = screen.getAllByRole("button");
      for (const btn of buttons) {
        expect(btn.tabIndex).not.toBe(-1);
      }
    });
  });

  // ── Goals Page ──────────────────────────────────────

  describe("GoalsPage keyboard interaction", () => {
    it("search input is focusable via Tab", async () => {
      const user = userEvent.setup();
      renderWithProviders(<GoalsPage />, {
        initialEntries: ["/dashboard/goals"],
      });

      const tabs = await tabsToReach(
        user,
        (el) => el?.tagName === "INPUT" && (el as HTMLInputElement).placeholder.includes("Search"),
      );
      expect(tabs).toBeGreaterThan(0);
    });

    it("New Goal button is reachable via Tab", async () => {
      const user = userEvent.setup();
      renderWithProviders(<GoalsPage />, {
        initialEntries: ["/dashboard/goals"],
      });

      const tabs = await tabsToReach(user, (el) => el?.textContent?.includes("New Goal") ?? false);
      expect(tabs).toBeGreaterThan(0);
    });

    it("goal list links are keyboard-navigable", async () => {
      const _user = userEvent.setup();
      renderWithProviders(<GoalsPage />, {
        initialEntries: ["/dashboard/goals"],
      });

      // Find links to individual goals
      const goalLinks = screen.getAllByRole("link");
      if (goalLinks.length > 0) {
        goalLinks[0].focus();
        expect(document.activeElement).toBe(goalLinks[0]);

        // Enter should be the default behavior for links — verify it's focusable
        expect(goalLinks[0].tabIndex).not.toBe(-1);
      }
    });

    it("filter selects are reachable via Tab", async () => {
      const _user = userEvent.setup();
      renderWithProviders(<GoalsPage />, {
        initialEntries: ["/dashboard/goals"],
      });

      // Selects should be reachable
      const selects = screen.queryAllByRole("combobox");
      for (const select of selects) {
        expect(select.tabIndex).not.toBe(-1);
      }
    });

    it("New Goal button opens dialog via Enter", async () => {
      const user = userEvent.setup();
      renderWithProviders(<GoalsPage />, {
        initialEntries: ["/dashboard/goals"],
      });

      // Tab to the New Goal button
      await tabsToReach(user, (el) => el?.textContent?.includes("New Goal") ?? false);

      // Press Enter to open dialog
      await user.keyboard("{Enter}");

      await waitFor(() => {
        expect(screen.getByRole("dialog")).toBeInTheDocument();
      });
    });

    it("New Goal button opens dialog via Space", async () => {
      const user = userEvent.setup();
      renderWithProviders(<GoalsPage />, {
        initialEntries: ["/dashboard/goals"],
      });

      // Tab to the New Goal button
      await tabsToReach(user, (el) => el?.textContent?.includes("New Goal") ?? false);

      // Press Space to activate
      await user.keyboard(" ");

      await waitFor(() => {
        expect(screen.getByRole("dialog")).toBeInTheDocument();
      });
    });
  });

  // ── GoalDetailPage ──────────────────────────────────

  describe("GoalDetailPage keyboard interaction", () => {
    it("all action buttons are reachable via Tab", async () => {
      const _user = userEvent.setup();
      renderWithProviders(<GoalDetailPage />, {
        initialEntries: ["/dashboard/goals/goal-1"],
      });

      const buttons = screen.queryAllByRole("button");
      for (const btn of buttons) {
        expect(btn.tabIndex).not.toBe(-1);
      }
    });

    it("Tab moves focus sequentially through interactive elements", async () => {
      const user = userEvent.setup();
      renderWithProviders(<GoalDetailPage />, {
        initialEntries: ["/dashboard/goals/goal-1"],
      });

      const visited = new Set<Element>();

      // Tab through and collect focused elements
      for (let i = 0; i < 15; i++) {
        await user.tab();
        if (document.activeElement && document.activeElement !== document.body) {
          visited.add(document.activeElement);
        }
      }

      // Should have visited multiple distinct interactive elements
      expect(visited.size).toBeGreaterThanOrEqual(2);
    });

    it("links have non-negative tabIndex", () => {
      renderWithProviders(<GoalDetailPage />, {
        initialEntries: ["/dashboard/goals/goal-1"],
      });

      const links = screen.queryAllByRole("link");
      for (const link of links) {
        expect(link.tabIndex).not.toBe(-1);
      }
    });
  });

  // ── Cross-cutting concerns ──────────────────────────

  describe("General keyboard accessibility", () => {
    it("no interactive element uses tabIndex > 0 (breaks natural order)", () => {
      renderWithProviders(<ChatPage />);

      const allInteractive = [
        ...screen.queryAllByRole("button"),
        ...screen.queryAllByRole("link"),
        ...screen.queryAllByRole("textbox"),
        ...screen.queryAllByRole("combobox"),
      ];

      for (const el of allInteractive) {
        // tabIndex > 0 breaks natural DOM order and is an anti-pattern
        expect(el.tabIndex).toBeLessThanOrEqual(0);
      }
    });

    it("buttons respond to Space keypress (native behavior preserved)", async () => {
      const handler = vi.fn();

      function SpaceTestComponent() {
        return <button onClick={handler}>Test Button</button>;
      }

      const user = userEvent.setup();
      renderWithProviders(<SpaceTestComponent />);

      const btn = screen.getByRole("button", { name: "Test Button" });
      btn.focus();
      await user.keyboard(" ");

      expect(handler).toHaveBeenCalledTimes(1);
    });

    it("buttons respond to Enter keypress (native behavior preserved)", async () => {
      const handler = vi.fn();

      function EnterTestComponent() {
        return <button onClick={handler}>Test Button</button>;
      }

      const user = userEvent.setup();
      renderWithProviders(<EnterTestComponent />);

      const btn = screen.getByRole("button", { name: "Test Button" });
      btn.focus();
      await user.keyboard("{Enter}");

      expect(handler).toHaveBeenCalledTimes(1);
    });
  });
});
