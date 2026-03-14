import { lazy } from "react";
import { createBrowserRouter } from "react-router";
import { App } from "@/app";

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
const UsagePage = lazy(() =>
  import("./usage").then((m) => ({ default: m.UsagePage })),
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
      { index: true, element: <OverviewPage /> },
      { path: "hud", element: <HudPage /> },
      { path: "goals", element: <GoalsPage /> },
      { path: "goals/:id", element: <GoalDetailPage /> },
      { path: "approvals", element: <ApprovalsPage /> },
      { path: "chat", element: <ChatPage /> },
      { path: "memories", element: <MemoriesPage /> },
      { path: "milestones", element: <MilestonesPage /> },
      { path: "activity", element: <ActivityPage /> },
      { path: "usage", element: <UsagePage /> },
      { path: "workspace", element: <WorkspacePage /> },
      { path: "pipelines", element: <PipelinesPage /> },
      { path: "pipelines/:jobId", element: <PipelineDetailPage /> },
      { path: "persona", element: <PersonaPage /> },
      { path: "patterns", element: <PatternsPage /> },
      { path: "journal", element: <JournalPage /> },
      { path: "settings", element: <SettingsPage /> },
    ],
  },
]);
