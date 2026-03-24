import { useState } from "react";
import { useDecisions, useDashboardUser } from "@/api/queries";
import { PageHeader } from "@/components/layout/page-header";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { ListSkeleton } from "@/components/common/loading-skeleton";
import { usePageTitle } from "@/hooks/use-page-title";
import { formatDate } from "@/lib/utils";
import { AlertTriangle, RefreshCw, Scale, Search } from "lucide-react";
import { Button } from "@/components/ui/button";

export function DecisionsPage() {
  usePageTitle("Decisions");
  const { data: user } = useDashboardUser();
  const [search, setSearch] = useState("");
  const { data, isLoading, error, refetch } = useDecisions(user?.id ?? "", search || undefined);
  const decisions = data?.data ?? [];

  return (
    <div>
      <PageHeader title="Decisions" description="Decisions made by the AI agent" />

      <div className="mb-4">
        <div className="relative max-w-sm">
          <Search className="absolute left-2.5 top-2.5 h-4 w-4 text-muted-foreground" />
          <input
            type="text"
            placeholder="Search decisions..."
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            className="w-full rounded-md border bg-background py-2 pl-9 pr-3 text-sm placeholder:text-muted-foreground focus:outline-none focus:ring-2 focus:ring-ring"
          />
        </div>
      </div>

      {error ? (
        <div className="flex flex-col items-center justify-center py-12 text-center">
          <AlertTriangle className="mb-3 h-8 w-8 text-destructive" />
          <p className="text-sm font-medium">Failed to load decisions</p>
          <p className="mt-1 text-xs text-muted-foreground">{error.message}</p>
          <Button variant="outline" size="sm" className="mt-3" onClick={() => refetch()}>
            <RefreshCw className="mr-1.5 h-3.5 w-3.5" />
            Retry
          </Button>
        </div>
      ) : isLoading ? (
        <ListSkeleton rows={5} />
      ) : decisions.length === 0 ? (
        <div className="flex flex-col items-center justify-center py-12 text-center">
          <Scale className="mb-3 h-8 w-8 text-muted-foreground" />
          <p className="text-sm font-medium">No decisions recorded yet</p>
          <p className="mt-1 text-xs text-muted-foreground">
            Decisions are automatically extracted from agent conversations.
          </p>
        </div>
      ) : (
        <div className="space-y-3">
          {decisions.map((d) => {
            const meta = d.metadata as {
              context?: string;
              alternatives?: string[];
              rationale?: string;
            } | null;
            return (
              <Card key={d.id}>
                <CardContent className="pt-4">
                  <div className="flex items-start justify-between gap-3">
                    <div className="min-w-0 flex-1">
                      <p className="text-sm font-medium">{d.key}</p>
                      <p className="mt-1 text-sm text-muted-foreground">{d.content}</p>
                      {meta?.rationale && (
                        <p className="mt-2 text-xs text-muted-foreground italic">
                          Rationale: {meta.rationale}
                        </p>
                      )}
                      {meta?.alternatives && meta.alternatives.length > 0 && (
                        <div className="mt-2 flex flex-wrap gap-1">
                          {meta.alternatives.map((alt, i) => (
                            <Badge key={i} variant="outline" className="text-xs">
                              {alt}
                            </Badge>
                          ))}
                        </div>
                      )}
                    </div>
                    <span className="shrink-0 text-xs text-muted-foreground">
                      {formatDate(d.createdAt)}
                    </span>
                  </div>
                </CardContent>
              </Card>
            );
          })}
        </div>
      )}
    </div>
  );
}
