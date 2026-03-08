import { ApiClient } from "@ai-cofounder/api-client";
import { getAccessToken, setAccessToken } from "@/hooks/use-auth";

const baseUrl = import.meta.env.VITE_API_URL || "";

export const apiClient = new ApiClient({
  baseUrl,
  getToken: getAccessToken,
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
