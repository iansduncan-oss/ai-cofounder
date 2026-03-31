import { useState } from "react";
import { useThinkingTraces, useConversations, useDashboardUser } from "@/api/queries";
import { PageHeader } from "@/components/layout/page-header";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { ListSkeleton } from "@/components/common/loading-skeleton";
import { usePageTitle } from "@/hooks/use-page-title";
import { formatDate } from "@/lib/utils";
import { BrainCircuit, ChevronDown, ChevronRight } from "lucide-react";

export function ThinkingPage() {
  usePageTitle("Thinking Traces");
  const { data: user } = useDashboardUser();
  const { data: convData } = useConversations(user?.id ?? "");
  const conversations = convData?.data ?? [];
  const [selectedConvId, setSelectedConvId] = useState("");
  const { data, isLoading } = useThinkingTraces(selectedConvId);
  const traces = data?.traces ?? [];
  const [expandedIds, setExpandedIds] = useState<Set<string>>(new Set());

  const toggle = (id: string) =>
    setExpandedIds((prev) => {
      const next = new Set(prev);
      next.has(id) ? next.delete(id) : next.add(id);
      return next;
    });

  return (
    <div>
      <PageHeader title="Thinking Traces" description="LLM reasoning steps captured during agent conversations" />

      <div className="mb-4 max-w-sm">
        <select
          value={selectedConvId}
          onChange={(e) => setSelectedConvId(e.target.value)}
          className="w-full rounded-md border bg-background px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-ring"
        >
          <option value="">Select a conversation...</option>
          {conversations.map((c) => (
            <option key={c.id} value={c.id}>
              {c.title || c.id.slice(0, 8)} &mdash; {formatDate(c.createdAt)}
            </option>
          ))}
        </select>
      </div>

      {!selectedConvId ? (
        <div className="flex flex-col items-center justify-center py-12 text-center">
          <BrainCircuit className="mb-3 h-8 w-8 text-muted-foreground" />
          <p className="text-sm font-medium">Select a conversation to view thinking traces</p>
        </div>
      ) : isLoading ? (
        <ListSkeleton rows={5} />
      ) : traces.length === 0 ? (
        <div className="flex flex-col items-center justify-center py-12 text-center">
          <BrainCircuit className="mb-3 h-8 w-8 text-muted-foreground" />
          <p className="text-sm font-medium">No thinking traces for this conversation</p>
        </div>
      ) : (
        <div className="space-y-2">
          {traces.map((t) => {
            const expanded = expandedIds.has(t.id);
            return (
              <Card key={t.id}>
                <CardContent className="pt-4">
                  <button
                    onClick={() => toggle(t.id)}
                    className="flex w-full items-center gap-2 text-left"
                  >
                    {expanded ? (
                      <ChevronDown className="h-4 w-4 shrink-0 text-muted-foreground" />
                    ) : (
                      <ChevronRight className="h-4 w-4 shrink-0 text-muted-foreground" />
                    )}
                    <span className="flex-1 text-sm font-medium">
                      Round {t.round}
                    </span>
                    <Badge variant="outline" className="text-xs">
                      {t.tokenCount} tokens
                    </Badge>
                    <span className="text-xs text-muted-foreground">
                      {formatDate(t.createdAt)}
                    </span>
                  </button>
                  {expanded && (
                    <pre className="mt-3 max-h-96 overflow-auto whitespace-pre-wrap rounded-md bg-muted p-3 text-xs">
                      {t.content}
                    </pre>
                  )}
                </CardContent>
              </Card>
            );
          })}
        </div>
      )}
    </div>
  );
}
