import { useEffect, useRef } from "react";
import type { RichCardInfo } from "@/hooks/use-stream-chat";
import { useCommandCenter, type PanelName } from "@/providers/command-center-provider";

const cardTypeToPanel: Record<string, PanelName> = {
  goal_progress: "goals",
  approval_needed: "goals",
  alert_detected: "monitor",
};

export function useAutoHighlight(richCards: RichCardInfo[]) {
  const { highlightPanel } = useCommandCenter();
  const processedCountRef = useRef(0);

  useEffect(() => {
    if (richCards.length <= processedCountRef.current) return;

    const newCards = richCards.slice(processedCountRef.current);
    processedCountRef.current = richCards.length;

    for (const card of newCards) {
      const panel = cardTypeToPanel[card.type] ?? "chat";
      highlightPanel(panel);
    }
  }, [richCards, highlightPanel]);
}
