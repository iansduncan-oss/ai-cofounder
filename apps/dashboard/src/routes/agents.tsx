import { useAgentCapabilities } from "@/api/queries";
import { PageHeader } from "@/components/layout/page-header";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { ListSkeleton } from "@/components/common/loading-skeleton";
import { usePageTitle } from "@/hooks/use-page-title";
import { Bot } from "lucide-react";

const ROLE_COLORS: Record<string, string> = {
  orchestrator: "bg-amber-100 text-amber-800 dark:bg-amber-900 dark:text-amber-200",
  researcher: "bg-blue-100 text-blue-800 dark:bg-blue-900 dark:text-blue-200",
  coder: "bg-green-100 text-green-800 dark:bg-green-900 dark:text-green-200",
  reviewer: "bg-purple-100 text-purple-800 dark:bg-purple-900 dark:text-purple-200",
  planner: "bg-cyan-100 text-cyan-800 dark:bg-cyan-900 dark:text-cyan-200",
  debugger: "bg-red-100 text-red-800 dark:bg-red-900 dark:text-red-200",
  doc_writer: "bg-indigo-100 text-indigo-800 dark:bg-indigo-900 dark:text-indigo-200",
  verifier: "bg-teal-100 text-teal-800 dark:bg-teal-900 dark:text-teal-200",
};

export function AgentsPage() {
  usePageTitle("Agent Roles");
  const { data, isLoading } = useAgentCapabilities();
  const agents = data?.agents ?? [];

  return (
    <div>
      <PageHeader title="Agent Roles" description="Specialist agents, their tools, and capabilities" />

      {isLoading ? (
        <ListSkeleton rows={4} />
      ) : agents.length === 0 ? (
        <div className="flex flex-col items-center justify-center py-12 text-center">
          <Bot className="mb-3 h-8 w-8 text-muted-foreground" />
          <p className="text-sm font-medium">No agent roles configured</p>
        </div>
      ) : (
        <div className="grid gap-4 sm:grid-cols-2">
          {agents.map((a) => (
            <Card key={a.role}>
              <CardContent className="pt-4">
                <div className="mb-2 flex items-center gap-2">
                  <Bot className="h-4 w-4 text-muted-foreground" />
                  <Badge className={ROLE_COLORS[a.role] ?? ""}>
                    {a.role}
                  </Badge>
                </div>
                <p className="mb-3 text-sm text-muted-foreground">{a.description}</p>

                {a.specialties.length > 0 && (
                  <div className="mb-3">
                    <p className="mb-1 text-xs font-medium text-muted-foreground">Specialties</p>
                    <div className="flex flex-wrap gap-1">
                      {a.specialties.map((s) => (
                        <Badge key={s} variant="secondary" className="text-xs">
                          {s}
                        </Badge>
                      ))}
                    </div>
                  </div>
                )}

                {a.tools.length > 0 && (
                  <div>
                    <p className="mb-1 text-xs font-medium text-muted-foreground">
                      Tools ({a.tools.length})
                    </p>
                    <div className="flex flex-wrap gap-1">
                      {a.tools.map((t) => (
                        <Badge key={t} variant="outline" className="text-xs">
                          {t}
                        </Badge>
                      ))}
                    </div>
                  </div>
                )}
              </CardContent>
            </Card>
          ))}
        </div>
      )}
    </div>
  );
}
