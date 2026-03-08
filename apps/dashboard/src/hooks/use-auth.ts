import { useState, useCallback } from "react";

// Module-level token — survives React re-renders, cleared on page reload
let _accessToken: string | null = null;

export function getAccessToken(): string | null {
  return _accessToken;
}

export function setAccessToken(token: string | null): void {
  _accessToken = token;
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

  return { isAuthenticated, login, logout, refresh };
}
