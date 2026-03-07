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

export const router = createBrowserRouter([
  {
    path: "/dashboard",
    element: <App />,
    children: [
      { index: true, element: <OverviewPage /> },
      { path: "goals", element: <GoalsPage /> },
      { path: "goals/:id", element: <GoalDetailPage /> },
      { path: "approvals", element: <ApprovalsPage /> },
      { path: "chat", element: <ChatPage /> },
      { path: "settings", element: <SettingsPage /> },
    ],
  },
]);
