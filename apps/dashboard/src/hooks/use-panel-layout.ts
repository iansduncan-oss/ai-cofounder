import { useState, useCallback, useEffect } from "react";

const STORAGE_KEY = "ai-cofounder-panel-layout";

interface PanelLayoutState {
  chatCollapsed: boolean;
  goalsCollapsed: boolean;
  monitorCollapsed: boolean;
  /** Horizontal split: percentage width of chat panel (0-100) */
  horizontalSplit: number;
  /** Vertical split: percentage height of goals panel within the right column (0-100) */
  verticalSplit: number;
}

const DEFAULT_STATE: PanelLayoutState = {
  chatCollapsed: false,
  goalsCollapsed: false,
  monitorCollapsed: false,
  horizontalSplit: 55,
  verticalSplit: 50,
};

function loadState(): PanelLayoutState {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (raw) return { ...DEFAULT_STATE, ...JSON.parse(raw) };
  } catch {
    // ignore
  }
  return DEFAULT_STATE;
}

export function usePanelLayout() {
  const [state, setState] = useState<PanelLayoutState>(loadState);

  useEffect(() => {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(state));
  }, [state]);

  const togglePanel = useCallback((panel: "chat" | "goals" | "monitor") => {
    setState((prev) => ({
      ...prev,
      [`${panel}Collapsed`]: !prev[`${panel}Collapsed` as keyof PanelLayoutState],
    }));
  }, []);

  const setHorizontalSplit = useCallback((value: number) => {
    setState((prev) => ({ ...prev, horizontalSplit: Math.min(80, Math.max(30, value)) }));
  }, []);

  const setVerticalSplit = useCallback((value: number) => {
    setState((prev) => ({ ...prev, verticalSplit: Math.min(80, Math.max(20, value)) }));
  }, []);

  return { ...state, togglePanel, setHorizontalSplit, setVerticalSplit };
}
