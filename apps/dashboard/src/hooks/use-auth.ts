import { useState, useCallback, useEffect, useRef } from "react";

// Module-level token — survives React re-renders, cleared on page reload
let _accessToken: string | null = null;

export function getAccessToken(): string | null {
  return _accessToken;
}

export function setAccessToken(token: string | null): void {
  _accessToken = token;
}

export type AdminRole = "admin" | "editor" | "viewer";

/** Decode JWT payload without verification (client-side only) */
function decodeJwtPayload(token: string): Record<string, unknown> | null {
  try {
    return JSON.parse(atob(token.split(".")[1]));
  } catch {
    return null;
  }
}

function decodeJwtExp(token: string): number | null {
  const payload = decodeJwtPayload(token);
  return typeof payload?.exp === "number" ? payload.exp : null;
}

function decodeJwtRole(token: string): AdminRole {
  const payload = decodeJwtPayload(token);
  const role = payload?.role;
  if (role === "admin" || role === "editor" || role === "viewer") return role;
  return "viewer";
}

export function getCurrentRole(): AdminRole {
  const token = getAccessToken();
  if (!token) return "viewer";
  return decodeJwtRole(token);
}

/**
 * useAuth — React hook for auth state management.
 * Uses module-level `_accessToken` as source of truth for the token value.
 * useState mirrors it to trigger re-renders on login/logout.
 */
export function useAuth() {
  const [, setToken] = useState<string | null>(_accessToken);
  const baseUrl = import.meta.env.VITE_API_URL || "";

  const isAuthenticated = !!_accessToken;

  const login = useCallback(
    async (email: string, password: string): Promise<void> => {
      const res = await fetch(`${baseUrl}/api/auth/login`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        credentials: "include",
        body: JSON.stringify({ email, password }),
      });

      if (!res.ok) {
        const body = (await res.json().catch(() => ({}))) as { error?: string };
        throw new Error(body.error ?? "Login failed");
      }

      const { accessToken } = (await res.json()) as { accessToken: string };
      setAccessToken(accessToken);
      setToken(accessToken);
    },
    [baseUrl],
  );

  const logout = useCallback(async (): Promise<void> => {
    setAccessToken(null);
    setToken(null);
    try {
      await fetch(`${baseUrl}/api/auth/logout`, {
        method: "POST",
        credentials: "include",
      });
    } catch {
      // Best-effort logout
    }
    window.location.href = "/dashboard/login";
  }, [baseUrl]);

  const refresh = useCallback(async (): Promise<string | null> => {
    try {
      const res = await fetch(`${baseUrl}/api/auth/refresh`, {
        method: "POST",
        credentials: "include",
      });
      if (!res.ok) {
        setAccessToken(null);
        setToken(null);
        return null;
      }
      const { accessToken } = (await res.json()) as { accessToken: string };
      setAccessToken(accessToken);
      setToken(accessToken);
      return accessToken;
    } catch {
      setAccessToken(null);
      setToken(null);
      return null;
    }
  }, [baseUrl]);

  const role = _accessToken ? decodeJwtRole(_accessToken) : "viewer" as AdminRole;

  return { isAuthenticated, login, logout, refresh, role };
}

/**
 * useProactiveRefresh — schedules a token refresh 60s before JWT expiry.
 * Re-schedules after each successful refresh. Call from App or AuthGuard.
 */
export function useProactiveRefresh() {
  const { refresh } = useAuth();
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const scheduleRefresh = useCallback(() => {
    if (timerRef.current) {
      clearTimeout(timerRef.current);
      timerRef.current = null;
    }

    const token = getAccessToken();
    if (!token) return;

    const exp = decodeJwtExp(token);
    if (!exp) return;

    const msUntilExpiry = exp * 1000 - Date.now();
    // Refresh 60s before expiry, minimum 5s from now
    const refreshIn = Math.max(msUntilExpiry - 60_000, 5_000);

    timerRef.current = setTimeout(async () => {
      const newToken = await refresh();
      if (newToken) {
        scheduleRefresh();
      }
    }, refreshIn);
  }, [refresh]);

  useEffect(() => {
    scheduleRefresh();
    return () => {
      if (timerRef.current !== null) clearTimeout(timerRef.current);
    };
  }, [scheduleRefresh]);

  // Re-schedule whenever the hook remounts or scheduleRefresh identity changes.
  // `_accessToken` is a module-level value and not a valid React dependency —
  // reads happen through getAccessToken() inside scheduleRefresh.
  useEffect(() => {
    if (_accessToken) {
      scheduleRefresh();
    }
  }, [scheduleRefresh]);
}
