import { lazy } from "react";
import { createBrowserRouter, Navigate } from "react-router";
import { App } from "@/app";
import { CommandCenter } from "@/components/layout/command-center";

const OverviewPage = lazy(() =>
  import("./overview").then((m) => ({ default: m.OverviewPage })),
);
const GoalsPage = lazy(() =>
  import("./goals").then((m) => ({ default: m.GoalsPage })),
);
const GoalDetailPage = lazy(() =>
  import("./goal-detail").then((m) => ({ default: m.GoalDetailPage })),
);
const ApprovalsPage = lazy(() =>
  import("./approvals").then((m) => ({ default: m.ApprovalsPage })),
);
const ChatPage = lazy(() =>
  import("./chat").then((m) => ({ default: m.ChatPage })),
);
const SettingsPage = lazy(() =>
  import("./settings").then((m) => ({ default: m.SettingsPage })),
);
const MemoriesPage = lazy(() =>
  import("./memories").then((m) => ({ default: m.MemoriesPage })),
);
const MilestonesPage = lazy(() =>
  import("./milestones").then((m) => ({ default: m.MilestonesPage })),
);
const ActivityPage = lazy(() =>
  import("./activity").then((m) => ({ default: m.ActivityPage })),
);
const AnalyticsPage = lazy(() =>
  import("./analytics").then((m) => ({ default: m.AnalyticsPage })),
);
const WorkspacePage = lazy(() =>
  import("./workspace").then((m) => ({ default: m.WorkspacePage })),
);
const HudPage = lazy(() =>
  import("./hud").then((m) => ({ default: m.HudPage })),
);
const PipelinesPage = lazy(() =>
  import("./pipelines").then((m) => ({ default: m.PipelinesPage })),
);
const PipelineDetailPage = lazy(() =>
  import("./pipeline-detail").then((m) => ({ default: m.PipelineDetailPage })),
);
const PersonaPage = lazy(() =>
  import("./persona").then((m) => ({ default: m.PersonaPage })),
);
const DlqPage = lazy(() =>
  import("./dlq").then((m) => ({ default: m.DlqPage })),
);
const SubagentsPage = lazy(() =>
  import("./subagents").then((m) => ({ default: m.SubagentsPage })),
);
const PatternsPage = lazy(() =>
  import("./patterns").then((m) => ({ default: m.PatternsPage })),
);
const JournalPage = lazy(() =>
  import("./journal").then((m) => ({ default: m.JournalPage })),
);
const LoginPage = lazy(() =>
  import("./login").then((m) => ({ default: m.LoginPage })),
);
const AuthCallbackPage = lazy(() =>
  import("./auth-callback").then((m) => ({ default: m.AuthCallbackPage })),
);
const N8nWorkflowsPage = lazy(() =>
  import("./n8n-workflows").then((m) => ({ default: m.N8nWorkflowsPage })),
);
const NotificationsPage = lazy(() =>
  import("./notifications").then((m) => ({ default: m.NotificationsPage })),
);
const AutonomousSessionsPage = lazy(() =>
  import("./autonomous-sessions").then((m) => ({ default: m.AutonomousSessionsPage })),
);
const GmailPage = lazy(() =>
  import("./gmail").then((m) => ({ default: m.GmailPage })),
);
const CalendarPage = lazy(() =>
  import("./calendar").then((m) => ({ default: m.CalendarPage })),
);
const FollowUpsPage = lazy(() =>
  import("./follow-ups").then((m) => ({ default: m.FollowUpsPage })),
);
const DecisionsPage = lazy(() =>
  import("./decisions").then((m) => ({ default: m.DecisionsPage })),
);
const EventsPage = lazy(() =>
  import("./events").then((m) => ({ default: m.EventsPage })),
);
const PipelineTemplatesPage = lazy(() =>
  import("./pipeline-templates").then((m) => ({ default: m.PipelineTemplatesPage })),
);
const WorkSessionsPage = lazy(() =>
  import("./work-sessions").then((m) => ({ default: m.WorkSessionsPage })),
);
const ThinkingPage = lazy(() =>
  import("./thinking").then((m) => ({ default: m.ThinkingPage })),
);
const ReflectionsPage = lazy(() =>
  import("./reflections").then((m) => ({ default: m.ReflectionsPage })),
);
const AgentsPage = lazy(() =>
  import("./agents").then((m) => ({ default: m.AgentsPage })),
);
const SchedulesPage = lazy(() =>
  import("./schedules").then((m) => ({ default: m.SchedulesPage })),
);
const KnowledgePage = lazy(() =>
  import("./knowledge").then((m) => ({ default: m.KnowledgePage })),
);
const SearchPage = lazy(() =>
  import("./search").then((m) => ({ default: m.SearchPage })),
);
const VoicePage = lazy(() =>
  import("./voice").then((m) => ({ default: m.VoicePage })),
);

export const router = createBrowserRouter([
  {
    path: "/dashboard/login",
    element: <LoginPage />,
  },
  {
    path: "/dashboard/auth/callback",
    element: <AuthCallbackPage />,
  },
  {
    path: "/dashboard",
    element: <App />,
    children: [
      { index: true, element: <CommandCenter /> },
      { path: "hud", element: <HudPage /> },
      { path: "goals", element: <GoalsPage /> },
      { path: "goals/:id", element: <GoalDetailPage /> },
      { path: "approvals", element: <ApprovalsPage /> },
      { path: "chat", element: <ChatPage /> },
      { path: "memories", element: <MemoriesPage /> },
      { path: "milestones", element: <MilestonesPage /> },
      { path: "activity", element: <ActivityPage /> },
      { path: "analytics", element: <AnalyticsPage /> },
      { path: "usage", element: <Navigate to="/dashboard/analytics" replace /> },
      { path: "workspace", element: <WorkspacePage /> },
      { path: "pipelines", element: <PipelinesPage /> },
      { path: "pipelines/:jobId", element: <PipelineDetailPage /> },
      { path: "n8n", element: <N8nWorkflowsPage /> },
      { path: "dlq", element: <DlqPage /> },
      { path: "subagents", element: <SubagentsPage /> },
      { path: "persona", element: <PersonaPage /> },
      { path: "patterns", element: <PatternsPage /> },
      { path: "journal", element: <JournalPage /> },
      { path: "notifications", element: <NotificationsPage /> },
      { path: "autonomous", element: <AutonomousSessionsPage /> },
      { path: "gmail", element: <GmailPage /> },
      { path: "calendar", element: <CalendarPage /> },
      { path: "follow-ups", element: <FollowUpsPage /> },
      { path: "decisions", element: <DecisionsPage /> },
      { path: "pipeline-templates", element: <PipelineTemplatesPage /> },
      { path: "events", element: <EventsPage /> },
      { path: "work-sessions", element: <WorkSessionsPage /> },
      { path: "thinking", element: <ThinkingPage /> },
      { path: "reflections", element: <ReflectionsPage /> },
      { path: "agents", element: <AgentsPage /> },
      { path: "schedules", element: <SchedulesPage /> },
      { path: "knowledge", element: <KnowledgePage /> },
      { path: "search", element: <SearchPage /> },
      { path: "voice", element: <VoicePage /> },
      { path: "settings", element: <SettingsPage /> },
      { path: "*", element: <Navigate to="/dashboard" replace /> },
    ],
  },
]);
