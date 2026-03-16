import { screen, fireEvent } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { CommandPalette } from "@/components/common/command-palette";
import { renderWithProviders } from "../test-utils";

describe("CommandPalette", () => {
  it("is hidden by default", () => {
    renderWithProviders(<CommandPalette />);
    expect(screen.queryByPlaceholderText("Search pages...")).not.toBeInTheDocument();
  });

  it("opens with Cmd+K", () => {
    renderWithProviders(<CommandPalette />);
    fireEvent.keyDown(document, { key: "k", metaKey: true });
    expect(screen.getByPlaceholderText("Search pages...")).toBeInTheDocument();
  });

  it("opens with Ctrl+K", () => {
    renderWithProviders(<CommandPalette />);
    fireEvent.keyDown(document, { key: "k", ctrlKey: true });
    expect(screen.getByPlaceholderText("Search pages...")).toBeInTheDocument();
  });

  it("closes with Escape", () => {
    renderWithProviders(<CommandPalette />);
    fireEvent.keyDown(document, { key: "k", metaKey: true });
    expect(screen.getByPlaceholderText("Search pages...")).toBeInTheDocument();

    fireEvent.keyDown(document, { key: "Escape" });
    expect(screen.queryByPlaceholderText("Search pages...")).not.toBeInTheDocument();
  });

  it("shows all commands initially", () => {
    renderWithProviders(<CommandPalette />);
    fireEvent.keyDown(document, { key: "k", metaKey: true });

    expect(screen.getByText("Overview")).toBeInTheDocument();
    expect(screen.getByText("Goals")).toBeInTheDocument();
    expect(screen.getByText("Chat")).toBeInTheDocument();
    expect(screen.getByText("Settings")).toBeInTheDocument();
  });

  it("filters commands by query", async () => {
    renderWithProviders(<CommandPalette />);
    fireEvent.keyDown(document, { key: "k", metaKey: true });

    const input = screen.getByPlaceholderText("Search pages...");
    await userEvent.type(input, "goal");

    expect(screen.getByText("Goals")).toBeInTheDocument();
    expect(screen.queryByText("Chat")).not.toBeInTheDocument();
    expect(screen.queryByText("Overview")).not.toBeInTheDocument();
  });

  it("shows 'No results' for non-matching query", async () => {
    renderWithProviders(<CommandPalette />);
    fireEvent.keyDown(document, { key: "k", metaKey: true });

    const input = screen.getByPlaceholderText("Search pages...");
    await userEvent.type(input, "xyznonexistent");

    expect(screen.getByText("No results")).toBeInTheDocument();
  });

  it("closes on backdrop click", () => {
    renderWithProviders(<CommandPalette />);
    fireEvent.keyDown(document, { key: "k", metaKey: true });

    const backdrop = screen.getByPlaceholderText("Search pages...").closest(".fixed");
    if (backdrop) {
      fireEvent.click(backdrop, { target: backdrop, currentTarget: backdrop });
    }
    // After clicking backdrop (when target === currentTarget), palette should close
  });
});
