import { useState, useEffect } from "react";
import { Navigate } from "react-router";
import type { ReactNode } from "react";
import { getAccessToken, setAccessToken, useProactiveRefresh } from "@/hooks/use-auth";

type AuthState = "checking" | "authenticated" | "unauthenticated";

export function AuthGuard({ children }: { children: ReactNode }) {
  const [state, setState] = useState<AuthState>(
    getAccessToken() ? "authenticated" : "checking",
  );

  useEffect(() => {
    if (getAccessToken()) {
      setState("authenticated");
      return;
    }

    // Attempt silent refresh via httpOnly cookie
    const baseUrl = import.meta.env.VITE_API_URL || "";
    fetch(`${baseUrl}/api/auth/refresh`, {
      method: "POST",
      credentials: "include",
    })
      .then(async (res) => {
        if (!res.ok) {
          setState("unauthenticated");
          return;
        }
        const { accessToken } = (await res.json()) as { accessToken: string };
        setAccessToken(accessToken);
        setState("authenticated");
      })
      .catch(() => {
        setState("unauthenticated");
      });
  }, []);

  if (state === "checking") {
    return (
      <div className="flex h-screen items-center justify-center">
        <div className="h-8 w-8 animate-spin rounded-full border-4 border-primary border-t-transparent" />
      </div>
    );
  }

  if (state === "unauthenticated") {
    return <Navigate to="/dashboard/login" replace />;
  }

  return <AuthenticatedContent>{children}</AuthenticatedContent>;
}

/** Wrapper that activates proactive refresh only when authenticated */
function AuthenticatedContent({ children }: { children: ReactNode }) {
  useProactiveRefresh();
  return <>{children}</>;
}
