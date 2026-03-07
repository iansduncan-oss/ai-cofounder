import { Outlet } from "react-router";
import { Sidebar } from "@/components/layout/sidebar";
import { ErrorBoundary } from "@/components/common/error-boundary";
import { CommandPalette } from "@/components/common/command-palette";

export function App() {
  return (
    <div className="flex h-screen overflow-hidden">
      <Sidebar />
      <main className="flex-1 overflow-y-auto p-6 md:p-6 pt-14 md:pt-6">
        <ErrorBoundary>
          <Outlet />
        </ErrorBoundary>
      </main>
      <CommandPalette />
    </div>
  );
}
