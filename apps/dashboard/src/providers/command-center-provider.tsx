import { createContext, useContext, useState, useCallback, useRef, type ReactNode } from "react";

export type PanelName = "chat" | "goals" | "monitor";

interface CommandCenterContextValue {
  /** Switch focus to chat panel, optionally pre-filling the input */
  focusChat: (prefill?: string) => void;
  /** Navigate goals panel to a specific goal detail */
  openGoal: (id: string) => void;
  /** Send alert context to chat for investigation */
  investigateAlert: (alertMessage: string) => void;
  /** Current chat prefill text (consumed by chat panel) */
  chatPrefill: string;
  /** Clear chat prefill after consumption */
  clearChatPrefill: () => void;
  /** Currently selected goal ID in goals panel (null = list view) */
  selectedGoalId: string | null;
  /** Go back to goals list */
  clearSelectedGoal: () => void;
  /** Active mobile tab */
  mobileTab: PanelName;
  /** Set mobile tab */
  setMobileTab: (tab: PanelName) => void;
  /** Currently highlighted panel (pulse animation), null = none */
  highlightedPanel: PanelName | null;
  /** Highlight a panel for 3 seconds */
  highlightPanel: (panel: PanelName) => void;
}

const CommandCenterContext = createContext<CommandCenterContextValue | null>(null);

export function CommandCenterProvider({ children }: { children: ReactNode }) {
  const [chatPrefill, setChatPrefill] = useState("");
  const [selectedGoalId, setSelectedGoalId] = useState<string | null>(null);
  const [mobileTab, setMobileTab] = useState<PanelName>("chat");
  const [highlightedPanel, setHighlightedPanel] = useState<PanelName | null>(null);
  const highlightTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const focusChat = useCallback((prefill?: string) => {
    if (prefill) setChatPrefill(prefill);
    setMobileTab("chat");
  }, []);

  const openGoal = useCallback((id: string) => {
    setSelectedGoalId(id);
    setMobileTab("goals");
  }, []);

  const investigateAlert = useCallback((alertMessage: string) => {
    setChatPrefill(`Investigate this alert: ${alertMessage}`);
    setMobileTab("chat");
  }, []);

  const clearChatPrefill = useCallback(() => setChatPrefill(""), []);
  const clearSelectedGoal = useCallback(() => setSelectedGoalId(null), []);

  const highlightPanel = useCallback((panel: PanelName) => {
    if (highlightTimerRef.current) clearTimeout(highlightTimerRef.current);
    setHighlightedPanel(panel);
    highlightTimerRef.current = setTimeout(() => setHighlightedPanel(null), 3000);
  }, []);

  return (
    <CommandCenterContext.Provider
      value={{
        focusChat,
        openGoal,
        investigateAlert,
        chatPrefill,
        clearChatPrefill,
        selectedGoalId,
        clearSelectedGoal,
        mobileTab,
        setMobileTab,
        highlightedPanel,
        highlightPanel,
      }}
    >
      {children}
    </CommandCenterContext.Provider>
  );
}

export function useCommandCenter(): CommandCenterContextValue {
  const ctx = useContext(CommandCenterContext);
  if (!ctx) throw new Error("useCommandCenter must be used within <CommandCenterProvider>");
  return ctx;
}
