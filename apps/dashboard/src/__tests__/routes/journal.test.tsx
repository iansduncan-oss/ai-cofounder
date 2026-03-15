import { screen, fireEvent } from "@testing-library/react";
import { JournalPage } from "@/routes/journal";
import { renderWithProviders } from "../test-utils";

vi.mock("@/api/client", () => ({
  apiClient: {
    listJournalEntries: vi.fn().mockResolvedValue({ data: [], total: 0 }),
    getStandup: vi.fn().mockResolvedValue(null),
  },
}));

vi.mock("@/api/queries", () => ({
  // journal.tsx uses useQuery directly from @tanstack/react-query, not a custom hook
  // but we need to provide any hooks it imports from @/api/queries
}));

// Helper to create a journal entry with a specific date
function makeEntry(id: string, dateStr: string) {
  return {
    id,
    entryType: "work_session" as const,
    title: `Entry ${id}`,
    summary: `Summary ${id}`,
    occurredAt: `${dateStr}T12:00:00Z`,
    goalId: null,
    details: null,
    createdAt: `${dateStr}T12:00:00Z`,
  };
}

// Get date strings
const today = new Date();
const todayStr = today.toISOString().split("T")[0];
const sevenDaysAgo = new Date(today.getTime() - 7 * 24 * 60 * 60 * 1000);
const sevenDaysAgoStr = sevenDaysAgo.toISOString().split("T")[0];
const tenDaysAgo = new Date(today.getTime() - 10 * 24 * 60 * 60 * 1000);
const tenDaysAgoStr = tenDaysAgo.toISOString().split("T")[0];

describe("JournalPage date-range filtering", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("renders date-range inputs (From and To)", async () => {
    const { apiClient } = await import("@/api/client");
    vi.mocked(apiClient.listJournalEntries).mockResolvedValue({
      data: [],
      total: 0,
    });
    vi.mocked(apiClient.getStandup).mockResolvedValue(null as never);

    renderWithProviders(<JournalPage />);

    expect(screen.getByLabelText(/from/i)).toBeInTheDocument();
    expect(screen.getByLabelText(/to/i)).toBeInTheDocument();
  });

  it("has default From set to 7 days ago and default To set to today", async () => {
    const { apiClient } = await import("@/api/client");
    vi.mocked(apiClient.listJournalEntries).mockResolvedValue({
      data: [],
      total: 0,
    });
    vi.mocked(apiClient.getStandup).mockResolvedValue(null as never);

    renderWithProviders(<JournalPage />);

    const fromInput = screen.getByLabelText(/from/i) as HTMLInputElement;
    const toInput = screen.getByLabelText(/to/i) as HTMLInputElement;

    expect(fromInput.value).toBe(sevenDaysAgoStr);
    expect(toInput.value).toBe(todayStr);
  });

  it("filters entries to show only those within date range", async () => {
    const { apiClient } = await import("@/api/client");
    const entries = [
      makeEntry("recent", todayStr),
      makeEntry("old", tenDaysAgoStr),
    ];
    vi.mocked(apiClient.listJournalEntries).mockResolvedValue({
      data: entries,
      total: 2,
    });
    vi.mocked(apiClient.getStandup).mockResolvedValue(null as never);

    renderWithProviders(<JournalPage />);

    // recent entry should show, old entry should be filtered out (default is 7-days to today)
    // Wait for entries to load
    await screen.findByText("Entry recent");
    expect(screen.queryByText("Entry old")).not.toBeInTheDocument();
  });

  it("shows all entries when date inputs are cleared", async () => {
    const { apiClient } = await import("@/api/client");
    const entries = [
      makeEntry("recent", todayStr),
      makeEntry("old", tenDaysAgoStr),
    ];
    vi.mocked(apiClient.listJournalEntries).mockResolvedValue({
      data: entries,
      total: 2,
    });
    vi.mocked(apiClient.getStandup).mockResolvedValue(null as never);

    renderWithProviders(<JournalPage />);

    // Clear the From date
    const fromInput = screen.getByLabelText(/from/i);
    fireEvent.change(fromInput, { target: { value: "" } });

    // Now both entries should show
    await screen.findByText("Entry recent");
    await screen.findByText("Entry old");
  });
});
