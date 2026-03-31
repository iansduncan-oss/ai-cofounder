import { ApiClient } from "@ai-cofounder/api-client";
import { getAccessToken, setAccessToken } from "@/hooks/use-auth";

const WORKSPACE_KEY = "ai-cofounder:workspaceId";

export function getStoredWorkspaceId(): string | null {
  return localStorage.getItem(WORKSPACE_KEY);
}

export function setStoredWorkspaceId(id: string | null) {
  if (id) localStorage.setItem(WORKSPACE_KEY, id);
  else localStorage.removeItem(WORKSPACE_KEY);
}

const baseUrl = import.meta.env.VITE_API_URL || "";

export const apiClient = new ApiClient({
  baseUrl,
  getToken: getAccessToken,
  getWorkspaceId: getStoredWorkspaceId,
  onUnauthorized: async () => {
    // Silent refresh using HttpOnly cookie — if successful, retry the original request
    const res = await fetch(`${baseUrl}/api/auth/refresh`, {
      method: "POST",
      credentials: "include",
    });
    if (!res.ok) {
      setAccessToken(null);
      window.location.href = "/dashboard/login";
      return null;
    }
    const { accessToken } = (await res.json()) as { accessToken: string };
    setAccessToken(accessToken);
    return accessToken;
  },
});
