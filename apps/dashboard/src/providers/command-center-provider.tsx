import { createContext, useContext, useState, useCallback, type ReactNode } from "react";

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
  mobileTab: "chat" | "goals" | "monitor";
  /** Set mobile tab */
  setMobileTab: (tab: "chat" | "goals" | "monitor") => void;
}

const CommandCenterContext = createContext<CommandCenterContextValue | null>(null);

export function CommandCenterProvider({ children }: { children: ReactNode }) {
  const [chatPrefill, setChatPrefill] = useState("");
  const [selectedGoalId, setSelectedGoalId] = useState<string | null>(null);
  const [mobileTab, setMobileTab] = useState<"chat" | "goals" | "monitor">("chat");

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
