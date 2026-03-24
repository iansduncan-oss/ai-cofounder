import { renderHook, act } from "@testing-library/react";
import { usePanelLayout } from "@/hooks/use-panel-layout";

describe("usePanelLayout", () => {
  it("returns default layout state", () => {
    const { result } = renderHook(() => usePanelLayout());

    expect(result.current.chatCollapsed).toBe(false);
    expect(result.current.goalsCollapsed).toBe(false);
    expect(result.current.monitorCollapsed).toBe(false);
    expect(result.current.horizontalSplit).toBe(55);
    expect(result.current.verticalSplit).toBe(50);
  });

  it("toggles chat panel collapsed state", () => {
    const { result } = renderHook(() => usePanelLayout());

    act(() => result.current.togglePanel("chat"));
    expect(result.current.chatCollapsed).toBe(true);

    act(() => result.current.togglePanel("chat"));
    expect(result.current.chatCollapsed).toBe(false);
  });

  it("toggles goals panel collapsed state", () => {
    const { result } = renderHook(() => usePanelLayout());

    act(() => result.current.togglePanel("goals"));
    expect(result.current.goalsCollapsed).toBe(true);

    act(() => result.current.togglePanel("goals"));
    expect(result.current.goalsCollapsed).toBe(false);
  });

  it("toggles monitor panel collapsed state", () => {
    const { result } = renderHook(() => usePanelLayout());

    act(() => result.current.togglePanel("monitor"));
    expect(result.current.monitorCollapsed).toBe(true);
  });

  it("sets horizontal split with clamping (30-80)", () => {
    const { result } = renderHook(() => usePanelLayout());

    act(() => result.current.setHorizontalSplit(65));
    expect(result.current.horizontalSplit).toBe(65);

    // Clamp to min 30
    act(() => result.current.setHorizontalSplit(10));
    expect(result.current.horizontalSplit).toBe(30);

    // Clamp to max 80
    act(() => result.current.setHorizontalSplit(95));
    expect(result.current.horizontalSplit).toBe(80);
  });

  it("sets vertical split with clamping (20-80)", () => {
    const { result } = renderHook(() => usePanelLayout());

    act(() => result.current.setVerticalSplit(60));
    expect(result.current.verticalSplit).toBe(60);

    // Clamp to min 20
    act(() => result.current.setVerticalSplit(5));
    expect(result.current.verticalSplit).toBe(20);

    // Clamp to max 80
    act(() => result.current.setVerticalSplit(90));
    expect(result.current.verticalSplit).toBe(80);
  });

  it("persists state to localStorage", () => {
    const { result } = renderHook(() => usePanelLayout());

    act(() => result.current.togglePanel("chat"));

    expect(localStorage.setItem).toHaveBeenCalledWith(
      "ai-cofounder-panel-layout",
      expect.stringContaining('"chatCollapsed":true'),
    );
  });

  it("restores state from localStorage", () => {
    const stored = JSON.stringify({
      chatCollapsed: true,
      goalsCollapsed: false,
      monitorCollapsed: true,
      horizontalSplit: 40,
      verticalSplit: 60,
    });
    localStorage.setItem("ai-cofounder-panel-layout", stored);

    const { result } = renderHook(() => usePanelLayout());

    expect(result.current.chatCollapsed).toBe(true);
    expect(result.current.monitorCollapsed).toBe(true);
    expect(result.current.horizontalSplit).toBe(40);
    expect(result.current.verticalSplit).toBe(60);
  });

  it("uses defaults when localStorage has invalid JSON", () => {
    localStorage.setItem("ai-cofounder-panel-layout", "not-json");

    const { result } = renderHook(() => usePanelLayout());

    expect(result.current.chatCollapsed).toBe(false);
    expect(result.current.horizontalSplit).toBe(55);
  });

  it("merges partial stored state with defaults", () => {
    localStorage.setItem(
      "ai-cofounder-panel-layout",
      JSON.stringify({ chatCollapsed: true }),
    );

    const { result } = renderHook(() => usePanelLayout());

    expect(result.current.chatCollapsed).toBe(true);
    // Defaults for unset fields
    expect(result.current.horizontalSplit).toBe(55);
    expect(result.current.verticalSplit).toBe(50);
  });
});
