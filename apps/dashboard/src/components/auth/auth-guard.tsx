import { Navigate } from "react-router";
import type { ReactNode } from "react";

export function AuthGuard({ children }: { children: ReactNode }) {
  const token = localStorage.getItem("ai-cofounder-token");

  if (!token) {
    return <Navigate to="/dashboard/login" replace />;
  }

  return <>{children}</>;
}

export function useAuth() {
  const token = localStorage.getItem("ai-cofounder-token");
  const isAuthenticated = !!token;

  const logout = () => {
    localStorage.removeItem("ai-cofounder-token");
    window.location.href = "/dashboard/login";
  };

  return { isAuthenticated, token, logout };
}
