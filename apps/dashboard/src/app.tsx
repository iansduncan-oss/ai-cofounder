import { useState } from "react";
import { Outlet, useLocation } from "react-router";
import { NavRail } from "@/components/layout/nav-rail";
import { StatusBar } from "@/components/layout/status-bar";
import { SecondaryDrawer } from "@/components/layout/secondary-drawer";
import { ErrorBoundary } from "@/components/common/error-boundary";
import { CommandPalette } from "@/components/common/command-palette";
import { GlobalChatBar } from "@/components/layout/global-chat-bar";
import { AuthGuard } from "@/components/auth/auth-guard";
import { CommandCenterProvider } from "@/providers/command-center-provider";
import { RealtimeProvider } from "@/providers/realtime-provider";

export function App() {
  const [drawerPath, setDrawerPath] = useState<string | null>(null);
  const location = useLocation();

  // Command center is the index route; secondary pages use standard layout
  const isIndex = location.pathname === "/dashboard" || location.pathname === "/dashboard/";

  return (
    <AuthGuard>
      <RealtimeProvider>
        <CommandCenterProvider>
          <div className="flex h-screen overflow-hidden bg-surface-0">
            <NavRail onDrawerOpen={(path) => setDrawerPath(path)} />
            <div className="flex flex-1 flex-col min-h-0 min-w-0">
              {isIndex ? (
                <div className="flex flex-1 min-h-0">
                  <ErrorBoundary>
                    <Outlet />
                  </ErrorBoundary>
                </div>
              ) : (
                <main className="flex-1 overflow-y-auto p-4 sm:p-6 pt-14 md:pt-6">
                  <ErrorBoundary>
                    <Outlet />
                  </ErrorBoundary>
                </main>
              )}
              <StatusBar />
            </div>
            <SecondaryDrawer activePath={drawerPath} onClose={() => setDrawerPath(null)} />
            <CommandPalette />
            <GlobalChatBar />
          </div>
        </CommandCenterProvider>
      </RealtimeProvider>
    </AuthGuard>
  );
}
