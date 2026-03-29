import { lazy, Suspense } from "react";
import { Drawer } from "@/components/ui/drawer";
import { ErrorBoundary } from "@/components/common/error-boundary";
import { Loader2 } from "lucide-react";

// Map paths to lazy-loaded page components
const pageMap: Record<string, { component: React.LazyExoticComponent<React.ComponentType>; title: string }> = {
  "/dashboard/goals": { component: lazy(() => import("@/routes/goals").then((m) => ({ default: m.GoalsPage }))), title: "Goals" },
  "/dashboard/approvals": { component: lazy(() => import("@/routes/approvals").then((m) => ({ default: m.ApprovalsPage }))), title: "Approvals" },
  "/dashboard/gmail": { component: lazy(() => import("@/routes/gmail").then((m) => ({ default: m.GmailPage }))), title: "Gmail" },
  "/dashboard/calendar": { component: lazy(() => import("@/routes/calendar").then((m) => ({ default: m.CalendarPage }))), title: "Calendar" },
  "/dashboard/n8n": { component: lazy(() => import("@/routes/n8n-workflows").then((m) => ({ default: m.N8nWorkflowsPage }))), title: "N8n Workflows" },
  "/dashboard/pipelines": { component: lazy(() => import("@/routes/pipelines").then((m) => ({ default: m.PipelinesPage }))), title: "Pipelines" },
  "/dashboard/memories": { component: lazy(() => import("@/routes/memories").then((m) => ({ default: m.MemoriesPage }))), title: "Memories" },
  "/dashboard/milestones": { component: lazy(() => import("@/routes/milestones").then((m) => ({ default: m.MilestonesPage }))), title: "Milestones" },
  "/dashboard/activity": { component: lazy(() => import("@/routes/activity").then((m) => ({ default: m.ActivityPage }))), title: "Activity" },
  "/dashboard/workspace": { component: lazy(() => import("@/routes/workspace").then((m) => ({ default: m.WorkspacePage }))), title: "Workspace" },
  "/dashboard/persona": { component: lazy(() => import("@/routes/persona").then((m) => ({ default: m.PersonaPage }))), title: "Persona" },
  "/dashboard/patterns": { component: lazy(() => import("@/routes/patterns").then((m) => ({ default: m.PatternsPage }))), title: "Patterns" },
  "/dashboard/journal": { component: lazy(() => import("@/routes/journal").then((m) => ({ default: m.JournalPage }))), title: "Journal" },
  "/dashboard/autonomous": { component: lazy(() => import("@/routes/autonomous-sessions").then((m) => ({ default: m.AutonomousSessionsPage }))), title: "Autonomous" },
  "/dashboard/dlq": { component: lazy(() => import("@/routes/dlq").then((m) => ({ default: m.DlqPage }))), title: "Dead Letter Queue" },
  "/dashboard/notifications": { component: lazy(() => import("@/routes/notifications").then((m) => ({ default: m.NotificationsPage }))), title: "Notifications" },
  "/dashboard/settings": { component: lazy(() => import("@/routes/settings").then((m) => ({ default: m.SettingsPage }))), title: "Settings" },
  "/dashboard/work-sessions": { component: lazy(() => import("@/routes/work-sessions").then((m) => ({ default: m.WorkSessionsPage }))), title: "Work Sessions" },
  "/dashboard/decisions": { component: lazy(() => import("@/routes/decisions").then((m) => ({ default: m.DecisionsPage }))), title: "Decisions" },
  "/dashboard/follow-ups": { component: lazy(() => import("@/routes/follow-ups").then((m) => ({ default: m.FollowUpsPage }))), title: "Follow-ups" },
  "/dashboard/pipeline-templates": { component: lazy(() => import("@/routes/pipeline-templates").then((m) => ({ default: m.PipelineTemplatesPage }))), title: "Pipeline Templates" },
  "/dashboard/events": { component: lazy(() => import("@/routes/events").then((m) => ({ default: m.EventsPage }))), title: "Events" },
  "/dashboard/subagents": { component: lazy(() => import("@/routes/subagents").then((m) => ({ default: m.SubagentsPage }))), title: "Subagents" },
};

interface SecondaryDrawerProps {
  activePath: string | null;
  onClose: () => void;
}

export function SecondaryDrawer({ activePath, onClose }: SecondaryDrawerProps) {
  const entry = activePath ? pageMap[activePath] : null;
  const PageComponent = entry?.component;

  return (
    <Drawer open={!!activePath} onClose={onClose} title={entry?.title}>
      {PageComponent && (
        <ErrorBoundary>
          <Suspense
            fallback={
              <div className="flex items-center justify-center py-12">
                <Loader2 className="h-5 w-5 animate-spin text-muted-foreground" />
              </div>
            }
          >
            <PageComponent />
          </Suspense>
        </ErrorBoundary>
      )}
    </Drawer>
  );
}
