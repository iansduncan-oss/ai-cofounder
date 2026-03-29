import { useEffect } from "react";
import { useNavigate } from "react-router";
import { setAccessToken } from "@/hooks/use-auth";

export function AuthCallbackPage() {
  const navigate = useNavigate();

  useEffect(() => {
    const baseUrl = import.meta.env.VITE_API_URL || "";

    fetch(`${baseUrl}/api/auth/refresh`, {
      method: "POST",
      credentials: "include",
    })
      .then(async (res) => {
        if (res.ok) {
          const { accessToken } = (await res.json()) as { accessToken: string };
          setAccessToken(accessToken);
          navigate("/dashboard", { replace: true });
        } else {
          navigate("/dashboard/login?error=oauth_invalid", { replace: true });
        }
      })
      .catch(() => {
        navigate("/dashboard/login?error=oauth_invalid", { replace: true });
      });
  }, [navigate]);

  return (
    <div className="flex min-h-screen items-center justify-center">
      <p className="text-muted-foreground">Signing in...</p>
    </div>
  );
}
