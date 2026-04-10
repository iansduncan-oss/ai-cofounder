import { renderHook } from "@testing-library/react";
import { createElement, type ReactNode } from "react";

// Mock the command-center-provider
const mockHighlightPanel = vi.fn();
vi.mock("@/providers/command-center-provider", () => ({
  useCommandCenter: () => ({ highlightPanel: mockHighlightPanel }),
}));

import { useAutoHighlight } from "@/hooks/use-auto-highlight";
import type { RichCardInfo } from "@/hooks/use-stream-chat";

describe("useAutoHighlight", () => {
  it("does nothing when richCards is empty", () => {
    renderHook(() => useAutoHighlight([]));
    expect(mockHighlightPanel).not.toHaveBeenCalled();
  });

  it('highlights "goals" panel for goal_progress card', () => {
    const cards: RichCardInfo[] = [{ type: "goal_progress", data: {} }];
    renderHook(() => useAutoHighlight(cards));
    expect(mockHighlightPanel).toHaveBeenCalledWith("goals");
  });

  it('highlights "goals" panel for approval_needed card', () => {
    const cards: RichCardInfo[] = [{ type: "approval_needed", data: {} }];
    renderHook(() => useAutoHighlight(cards));
    expect(mockHighlightPanel).toHaveBeenCalledWith("goals");
  });

  it('highlights "monitor" panel for alert_detected card', () => {
    const cards: RichCardInfo[] = [{ type: "alert_detected", data: {} }];
    renderHook(() => useAutoHighlight(cards));
    expect(mockHighlightPanel).toHaveBeenCalledWith("monitor");
  });

  it('defaults to "chat" panel for unknown card type', () => {
    const cards: RichCardInfo[] = [{ type: "some_unknown_type", data: {} }];
    renderHook(() => useAutoHighlight(cards));
    expect(mockHighlightPanel).toHaveBeenCalledWith("chat");
  });

  it("only processes new cards, not previously seen ones", () => {
    const initialCards: RichCardInfo[] = [{ type: "goal_progress", data: {} }];
    const { rerender } = renderHook(
      ({ cards }) => useAutoHighlight(cards),
      { initialProps: { cards: initialCards } },
    );

    expect(mockHighlightPanel).toHaveBeenCalledTimes(1);
    expect(mockHighlightPanel).toHaveBeenCalledWith("goals");

    mockHighlightPanel.mockClear();

    // Rerender with same cards — should not re-process
    rerender({ cards: initialCards });
    expect(mockHighlightPanel).not.toHaveBeenCalled();

    // Add a new card — should only process the new one
    const updatedCards: RichCardInfo[] = [
      ...initialCards,
      { type: "alert_detected", data: {} },
    ];
    rerender({ cards: updatedCards });
    expect(mockHighlightPanel).toHaveBeenCalledTimes(1);
    expect(mockHighlightPanel).toHaveBeenCalledWith("monitor");
  });

  it("processes multiple new cards at once", () => {
    const cards: RichCardInfo[] = [
      { type: "goal_progress", data: {} },
      { type: "alert_detected", data: {} },
      { type: "unknown_type", data: {} },
    ];
    renderHook(() => useAutoHighlight(cards));

    expect(mockHighlightPanel).toHaveBeenCalledTimes(3);
    expect(mockHighlightPanel).toHaveBeenNthCalledWith(1, "goals");
    expect(mockHighlightPanel).toHaveBeenNthCalledWith(2, "monitor");
    expect(mockHighlightPanel).toHaveBeenNthCalledWith(3, "chat");
  });
});
