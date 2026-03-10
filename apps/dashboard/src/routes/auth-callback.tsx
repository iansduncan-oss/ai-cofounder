import { useEffect } from "react";
import { useNavigate, useSearchParams } from "react-router";
import { setAccessToken } from "@/hooks/use-auth";

export function AuthCallbackPage() {
  const navigate = useNavigate();
  const [searchParams] = useSearchParams();

  useEffect(() => {
    const token = searchParams.get("token");
    if (token) {
      setAccessToken(token);
      navigate("/dashboard", { replace: true });
    } else {
      navigate("/dashboard/login?error=oauth_invalid", { replace: true });
    }
  }, [searchParams, navigate]);

  return (
    <div className="flex min-h-screen items-center justify-center">
      <p className="text-muted-foreground">Signing in...</p>
    </div>
  );
}
