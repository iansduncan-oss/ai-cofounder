import { Navigate } from "react-router";
import type { ReactNode } from "react";
import { getAccessToken } from "@/hooks/use-auth";

export function AuthGuard({ children }: { children: ReactNode }) {
  if (!getAccessToken()) {
    return <Navigate to="/dashboard/login" replace />;
  }
  return <>{children}</>;
}
