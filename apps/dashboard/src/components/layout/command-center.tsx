import { useRef } from "react";
import { Panel } from "@/components/ui/panel";
import { TabBar } from "@/components/ui/tab-bar";
import { usePanelLayout } from "@/hooks/use-panel-layout";
import { useResizable } from "@/hooks/use-resizable";
import { useCommandCenter } from "@/providers/command-center-provider";
import { ChatPanel } from "@/components/command-center/chat-panel";
import { GoalsPanel } from "@/components/command-center/goals-panel";
import { MonitoringPanel } from "@/components/command-center/monitoring-panel";
import { usePendingApprovals } from "@/api/queries";
import { useMonitoringStatus } from "@/api/queries";
import { MessageSquare, Target, Activity } from "lucide-react";
import { Badge } from "@/components/ui/badge";

export function CommandCenter() {
  const layout = usePanelLayout();
  const containerRef = useRef<HTMLDivElement>(null);
  const rightColumnRef = useRef<HTMLDivElement>(null);
  const { mobileTab, setMobileTab, highlightedPanel } = useCommandCenter();
  const { data: approvals } = usePendingApprovals();
  const { data: monitoring } = useMonitoringStatus();

  const hResize = useResizable({
    direction: "horizontal",
    onResize: layout.setHorizontalSplit,
    containerRef,
  });

  const vResize = useResizable({
    direction: "vertical",
    onResize: layout.setVerticalSplit,
    containerRef: rightColumnRef,
  });

  const approvalCount = approvals?.length ?? 0;
  const alertCount = monitoring?.alerts?.length ?? 0;

  const mobileTabs = [
    { id: "chat", label: "Chat", icon: <MessageSquare className="h-5 w-5" /> },
    {
      id: "goals",
      label: "Goals",
      icon: <Target className="h-5 w-5" />,
      notificationCount: approvalCount,
    },
    {
      id: "monitor",
      label: "Monitor",
      icon: <Activity className="h-5 w-5" />,
      notificationCount: alertCount,
    },
  ];

  return (
    <>
      {/* Desktop: three-panel layout */}
      <div ref={containerRef} className="hidden md:flex flex-1 min-h-0 gap-0">
        {/* Chat panel */}
        <div
          className="min-w-0 flex flex-col"
          style={{ width: layout.chatCollapsed ? "40px" : `${layout.horizontalSplit}%` }}
        >
          <Panel
            title="Chat"
            icon={<MessageSquare className="h-3 w-3" />}
            collapsed={layout.chatCollapsed}
            onToggle={() => layout.togglePanel("chat")}
            glowColor="chat"
            isHighlighted={highlightedPanel === "chat"}
          >
            <ChatPanel />
          </Panel>
        </div>

        {/* Horizontal resize handle */}
        {!layout.chatCollapsed && (
          <div
            className="w-1 cursor-col-resize flex items-center justify-center group hover:bg-primary/20 transition-colors shrink-0"
            onPointerDown={hResize.handlePointerDown}
          >
            <div className="w-0.5 h-8 rounded-full bg-border group-hover:bg-primary/50 transition-colors" />
          </div>
        )}

        {/* Right column: goals + monitoring */}
        <div
          ref={rightColumnRef}
          className="min-w-0 flex flex-col gap-0 flex-1"
        >
          {/* Goals panel */}
          <div
            className="min-h-0 flex flex-col"
            style={{
              height: layout.goalsCollapsed
                ? "auto"
                : layout.monitorCollapsed
                  ? "100%"
                  : `${layout.verticalSplit}%`,
              flex: layout.goalsCollapsed ? "none" : undefined,
            }}
          >
            <Panel
              title="Goals"
              icon={<Target className="h-3 w-3" />}
              collapsed={layout.goalsCollapsed}
              onToggle={() => layout.togglePanel("goals")}
              glowColor="goals"
              isHighlighted={highlightedPanel === "goals"}
              badge={
                approvalCount > 0 ? (
                  <Badge variant="warning" className="text-[9px] px-1 py-0">{approvalCount}</Badge>
                ) : undefined
              }
            >
              <GoalsPanel />
            </Panel>
          </div>

          {/* Vertical resize handle */}
          {!layout.goalsCollapsed && !layout.monitorCollapsed && (
            <div
              className="h-1 cursor-row-resize flex justify-center items-center group hover:bg-primary/20 transition-colors shrink-0"
              onPointerDown={vResize.handlePointerDown}
            >
              <div className="h-0.5 w-8 rounded-full bg-border group-hover:bg-primary/50 transition-colors" />
            </div>
          )}

          {/* Monitoring panel */}
          <div
            className="min-h-0 flex flex-col"
            style={{
              height: layout.monitorCollapsed
                ? "auto"
                : layout.goalsCollapsed
                  ? "100%"
                  : `${100 - layout.verticalSplit}%`,
              flex: layout.monitorCollapsed ? "none" : undefined,
            }}
          >
            <Panel
              title="Monitor"
              icon={<Activity className="h-3 w-3" />}
              collapsed={layout.monitorCollapsed}
              onToggle={() => layout.togglePanel("monitor")}
              glowColor="monitor"
              isHighlighted={highlightedPanel === "monitor"}
              badge={
                alertCount > 0 ? (
                  <Badge variant="destructive" className="text-[9px] px-1 py-0">{alertCount}</Badge>
                ) : undefined
              }
            >
              <MonitoringPanel />
            </Panel>
          </div>
        </div>
      </div>

      {/* Mobile: single panel with tab bar */}
      <div className="flex flex-1 flex-col min-h-0 md:hidden pb-12">
        {mobileTab === "chat" && <ChatPanel />}
        {mobileTab === "goals" && <GoalsPanel />}
        {mobileTab === "monitor" && <MonitoringPanel />}
      </div>

      {/* Mobile tab bar */}
      <TabBar
        tabs={mobileTabs}
        activeTab={mobileTab}
        onTabChange={(id) => setMobileTab(id as "chat" | "goals" | "monitor")}
      />
    </>
  );
}
