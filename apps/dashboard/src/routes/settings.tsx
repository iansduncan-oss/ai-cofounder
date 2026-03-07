import { useHealth, useProviderHealth } from "@/api/queries";
import { PageHeader } from "@/components/layout/page-header";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { ListSkeleton } from "@/components/common/loading-skeleton";
import { formatDate } from "@/lib/utils";
import { usePageTitle } from "@/hooks/use-page-title";
import { AlertTriangle } from "lucide-react";

export function SettingsPage() {
  usePageTitle("Settings");
  const { data: health, isLoading: healthLoading, error: healthError } = useHealth();
  const { data: providers, isLoading: providersLoading, error: providersError } = useProviderHealth();

  return (
    <div>
      <PageHeader
        title="Settings"
        description="System health and provider status"
      />

      <div className="space-y-6">
        <Card>
          <CardHeader>
            <CardTitle>System Health</CardTitle>
          </CardHeader>
          <CardContent>
            {healthLoading ? (
              <ListSkeleton rows={1} />
            ) : healthError ? (
              <div className="flex items-center gap-2 text-sm text-destructive">
                <AlertTriangle className="h-4 w-4" />
                <span>Failed to load health data: {healthError.message}</span>
              </div>
            ) : health ? (
              <div className="grid grid-cols-3 gap-4">
                <div>
                  <p className="text-sm text-muted-foreground">Status</p>
                  <Badge
                    variant={health.status === "ok" ? "success" : "warning"}
                  >
                    {health.status}
                  </Badge>
                </div>
                <div>
                  <p className="text-sm text-muted-foreground">Uptime</p>
                  <p className="text-sm font-medium">
                    {Math.floor(health.uptime / 3600)}h{" "}
                    {Math.floor((health.uptime % 3600) / 60)}m
                  </p>
                </div>
                <div>
                  <p className="text-sm text-muted-foreground">Last Check</p>
                  <p className="text-sm font-medium">
                    {formatDate(health.timestamp)}
                  </p>
                </div>
              </div>
            ) : (
              <p className="text-sm text-muted-foreground">
                Unable to reach server
              </p>
            )}
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle>LLM Providers</CardTitle>
          </CardHeader>
          <CardContent>
            {providersLoading ? (
              <ListSkeleton rows={4} />
            ) : providersError ? (
              <div className="flex items-center gap-2 text-sm text-destructive">
                <AlertTriangle className="h-4 w-4" />
                <span>Failed to load providers: {providersError.message}</span>
              </div>
            ) : providers?.providers && providers.providers.length > 0 ? (
              <div className="overflow-x-auto">
                <table className="w-full text-sm">
                  <thead>
                    <tr className="border-b text-left text-muted-foreground">
                      <th className="pb-2 pr-4">Provider</th>
                      <th className="pb-2 pr-4">Status</th>
                      <th className="pb-2 pr-4">Requests</th>
                      <th className="pb-2 pr-4">Success</th>
                      <th className="pb-2 pr-4">Errors</th>
                      <th className="pb-2 pr-4">Avg Latency</th>
                    </tr>
                  </thead>
                  <tbody>
                    {providers.providers.map((p) => (
                      <tr key={p.provider} className="border-b last:border-0">
                        <td className="py-2 pr-4 font-medium">{p.provider}</td>
                        <td className="py-2 pr-4">
                          <Badge
                            variant={p.available ? "success" : "destructive"}
                          >
                            {p.available ? "available" : "unavailable"}
                          </Badge>
                        </td>
                        <td className="py-2 pr-4">{p.totalRequests}</td>
                        <td className="py-2 pr-4">{p.successCount}</td>
                        <td className="py-2 pr-4">{p.errorCount}</td>
                        <td className="py-2 pr-4">{p.avgLatencyMs}ms</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            ) : (
              <p className="text-sm text-muted-foreground">
                No provider data available
              </p>
            )}
          </CardContent>
        </Card>
      </div>
    </div>
  );
}
