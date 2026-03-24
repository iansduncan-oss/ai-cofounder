import { useState, useMemo } from "react";
import { useEvents, useReprocessEvent } from "@/api/queries";
import { PageHeader } from "@/components/layout/page-header";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Select } from "@/components/ui/select";
import { ListSkeleton } from "@/components/common/loading-skeleton";
import { EventDetailDrawer } from "@/components/events/event-detail-drawer";
import { usePageTitle } from "@/hooks/use-page-title";
import { formatDate } from "@/lib/utils";
import { AlertTriangle, RefreshCw, Webhook, Inbox } from "lucide-react";
import { Button } from "@/components/ui/button";
import type { Event } from "@ai-cofounder/api-client";

export function EventsPage() {
  usePageTitle("Events");

  const [sourceFilter, setSourceFilter] = useState("");
  const [typeFilter, setTypeFilter] = useState("");
  const [processedFilter, setProcessedFilter] = useState<string>("");
  const [selectedEvent, setSelectedEvent] = useState<Event | null>(null);

  const filters = useMemo(() => ({
    source: sourceFilter || undefined,
    type: typeFilter || undefined,
    processed: processedFilter === "" ? undefined : processedFilter === "true",
  }), [sourceFilter, typeFilter, processedFilter]);

  const { data, isLoading, error, refetch } = useEvents(filters);
  const reprocess = useReprocessEvent();
  const events = data?.data ?? [];
  const total = data?.total ?? 0;

  // Derive unique sources/types for filter dropdowns
  const sources = useMemo(() => [...new Set(events.map((e) => e.source))].sort(), [events]);
  const types = useMemo(() => [...new Set(events.map((e) => e.type))].sort(), [events]);

  // Summary stats
  const processedCount = events.filter((e) => e.processed).length;
  const failedCount = events.filter((e) => e.result?.startsWith("Error:")).length;

  return (
    <div>
      <PageHeader
        title="Events"
        description="Webhook events and their processing status"
        actions={
          <Button variant="outline" size="sm" onClick={() => refetch()}>
            <RefreshCw className="mr-1.5 h-3.5 w-3.5" />
            Refresh
          </Button>
        }
      />

      {/* Summary stats */}
      <div className="mb-4 flex flex-wrap gap-3 text-sm">
        <span className="text-muted-foreground">
          Total: <span className="font-medium text-foreground">{total}</span>
        </span>
        <span className="text-muted-foreground">
          Processed: <span className="font-medium text-emerald-500">{processedCount}</span>
        </span>
        {failedCount > 0 && (
          <span className="text-muted-foreground">
            Failed: <span className="font-medium text-destructive">{failedCount}</span>
          </span>
        )}
      </div>

      {/* Filters */}
      <div className="mb-4 flex flex-wrap gap-2">
        <Select
          value={sourceFilter}
          onChange={(e) => setSourceFilter(e.target.value)}
          className="w-40"
        >
          <option value="">All Sources</option>
          {sources.map((s) => (
            <option key={s} value={s}>{s}</option>
          ))}
        </Select>
        <Select
          value={typeFilter}
          onChange={(e) => setTypeFilter(e.target.value)}
          className="w-40"
        >
          <option value="">All Types</option>
          {types.map((t) => (
            <option key={t} value={t}>{t}</option>
          ))}
        </Select>
        <Select
          value={processedFilter}
          onChange={(e) => setProcessedFilter(e.target.value)}
          className="w-40"
        >
          <option value="">All Status</option>
          <option value="true">Processed</option>
          <option value="false">Pending</option>
        </Select>
      </div>

      {/* Event list */}
      {error ? (
        <div className="flex flex-col items-center justify-center py-12 text-center">
          <AlertTriangle className="mb-3 h-8 w-8 text-destructive" />
          <p className="text-sm font-medium">Failed to load events</p>
          <p className="mt-1 text-xs text-muted-foreground">{error.message}</p>
          <Button variant="outline" size="sm" className="mt-3" onClick={() => refetch()}>
            <RefreshCw className="mr-1.5 h-3.5 w-3.5" />
            Retry
          </Button>
        </div>
      ) : isLoading ? (
        <ListSkeleton rows={5} />
      ) : events.length === 0 ? (
        <div className="flex flex-col items-center justify-center py-12 text-center">
          <Inbox className="mb-3 h-8 w-8 text-muted-foreground" />
          <p className="text-sm font-medium">No events found</p>
          <p className="mt-1 text-xs text-muted-foreground">
            Events appear here when webhooks are received.
          </p>
        </div>
      ) : (
        <div className="space-y-2">
          {events.map((event) => (
            <Card
              key={event.id}
              className="cursor-pointer hover:bg-accent/30 transition-colors"
              onClick={() => setSelectedEvent(event)}
            >
              <CardContent className="py-3">
                <div className="flex items-center justify-between gap-3">
                  <div className="flex items-center gap-2 min-w-0">
                    <Webhook className="h-4 w-4 shrink-0 text-muted-foreground" />
                    <Badge variant="secondary" className="shrink-0">{event.source}</Badge>
                    <Badge variant="outline" className="shrink-0">{event.type}</Badge>
                    <Badge variant={event.processed ? "success" : "warning"} className="shrink-0">
                      {event.processed ? "Processed" : "Pending"}
                    </Badge>
                    {event.result && (
                      <span className="text-xs text-muted-foreground truncate">
                        {event.result.slice(0, 80)}
                        {event.result.length > 80 ? "..." : ""}
                      </span>
                    )}
                  </div>
                  <span className="shrink-0 text-xs text-muted-foreground whitespace-nowrap">
                    {formatDate(event.createdAt)}
                  </span>
                </div>
              </CardContent>
            </Card>
          ))}
        </div>
      )}

      {/* Detail drawer */}
      <EventDetailDrawer
        event={selectedEvent}
        open={!!selectedEvent}
        onClose={() => setSelectedEvent(null)}
        onReprocess={(id) => reprocess.mutate(id)}
        isReprocessing={reprocess.isPending}
      />
    </div>
  );
}
