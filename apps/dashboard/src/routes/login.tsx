import { useState } from "react";
import { useNavigate } from "react-router";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { usePageTitle } from "@/hooks/use-page-title";
import { AlertTriangle, LogIn } from "lucide-react";

export function LoginPage() {
  usePageTitle("Login");
  const navigate = useNavigate();
  const [secret, setSecret] = useState("");
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!secret.trim()) return;

    setLoading(true);
    setError("");

    try {
      // Validate the secret against the health endpoint
      const baseUrl = import.meta.env.VITE_API_URL || "";
      const res = await fetch(`${baseUrl}/health`, {
        headers: { Authorization: `Bearer ${secret.trim()}` },
      });

      if (res.ok) {
        localStorage.setItem("ai-cofounder-token", secret.trim());
        navigate("/dashboard");
      } else {
        setError("Invalid API secret");
      }
    } catch {
      setError("Unable to connect to server");
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="flex min-h-screen items-center justify-center bg-background p-4">
      <Card className="w-full max-w-sm">
        <CardHeader className="text-center">
          <div className="mx-auto mb-3 flex h-12 w-12 items-center justify-center rounded-lg bg-primary text-lg font-bold text-primary-foreground">
            AI
          </div>
          <CardTitle>AI Cofounder</CardTitle>
          <p className="text-sm text-muted-foreground">
            Enter your API secret to access the dashboard
          </p>
        </CardHeader>
        <CardContent>
          <form onSubmit={handleSubmit} className="space-y-4">
            <div>
              <Input
                type="password"
                placeholder="API Secret"
                value={secret}
                onChange={(e) => setSecret(e.target.value)}
                autoFocus
              />
            </div>
            {error && (
              <div className="flex items-center gap-2 text-sm text-destructive">
                <AlertTriangle className="h-3.5 w-3.5" />
                {error}
              </div>
            )}
            <Button
              type="submit"
              className="w-full"
              disabled={!secret.trim() || loading}
            >
              <LogIn className="mr-2 h-4 w-4" />
              {loading ? "Signing in..." : "Sign In"}
            </Button>
          </form>
        </CardContent>
      </Card>
    </div>
  );
}
