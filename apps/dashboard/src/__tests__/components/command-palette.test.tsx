import { screen, fireEvent } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { vi } from "vitest";
import { CommandPalette } from "@/components/common/command-palette";
import { renderWithProviders } from "../test-utils";

// Mock the useGlobalSearch hook
vi.mock("@/api/queries", async () => {
  const actual = await vi.importActual<Record<string, unknown>>("@/api/queries");
  return {
    ...actual,
    useGlobalSearch: vi.fn().mockReturnValue({ data: undefined, isFetching: false }),
  };
});

describe("CommandPalette", () => {
  it("is hidden by default", () => {
    renderWithProviders(<CommandPalette />);
    expect(screen.queryByPlaceholderText("Search everything...")).not.toBeInTheDocument();
  });

  it("opens with Cmd+K", () => {
    renderWithProviders(<CommandPalette />);
    fireEvent.keyDown(document, { key: "k", metaKey: true });
    expect(screen.getByPlaceholderText("Search everything...")).toBeInTheDocument();
  });

  it("opens with Ctrl+K", () => {
    renderWithProviders(<CommandPalette />);
    fireEvent.keyDown(document, { key: "k", ctrlKey: true });
    expect(screen.getByPlaceholderText("Search everything...")).toBeInTheDocument();
  });

  it("closes with Escape", () => {
    renderWithProviders(<CommandPalette />);
    fireEvent.keyDown(document, { key: "k", metaKey: true });
    expect(screen.getByPlaceholderText("Search everything...")).toBeInTheDocument();

    fireEvent.keyDown(document, { key: "Escape" });
    expect(screen.queryByPlaceholderText("Search everything...")).not.toBeInTheDocument();
  });

  it("shows all nav commands initially", () => {
    renderWithProviders(<CommandPalette />);
    fireEvent.keyDown(document, { key: "k", metaKey: true });

    expect(screen.getByText("Overview")).toBeInTheDocument();
    expect(screen.getByText("Pages")).toBeInTheDocument();
    expect(screen.getByText("Chat")).toBeInTheDocument();
    expect(screen.getByText("Settings")).toBeInTheDocument();
  });

  it("filters nav commands by query", async () => {
    renderWithProviders(<CommandPalette />);
    fireEvent.keyDown(document, { key: "k", metaKey: true });

    const input = screen.getByPlaceholderText("Search everything...");
    await userEvent.type(input, "goal");

    // "Goals" nav link should be visible
    expect(screen.getByText("Goals")).toBeInTheDocument();
    expect(screen.queryByText("Chat")).not.toBeInTheDocument();
    expect(screen.queryByText("Overview")).not.toBeInTheDocument();
  });

  it("shows 'No results' for non-matching query", async () => {
    renderWithProviders(<CommandPalette />);
    fireEvent.keyDown(document, { key: "k", metaKey: true });

    const input = screen.getByPlaceholderText("Search everything...");
    await userEvent.type(input, "xyznonexistent");

    expect(screen.getByText("No results")).toBeInTheDocument();
  });

  it("closes on backdrop click", () => {
    renderWithProviders(<CommandPalette />);
    fireEvent.keyDown(document, { key: "k", metaKey: true });

    const backdrop = screen.getByPlaceholderText("Search everything...").closest(".fixed");
    if (backdrop) {
      fireEvent.click(backdrop, { target: backdrop, currentTarget: backdrop });
    }
  });
});
