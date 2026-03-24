import type { Event } from "@ai-cofounder/api-client";
import { Drawer } from "@/components/ui/drawer";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { formatDate } from "@/lib/utils";
import { RefreshCw } from "lucide-react";

interface EventDetailDrawerProps {
  event: Event | null;
  open: boolean;
  onClose: () => void;
  onReprocess: (id: string) => void;
  isReprocessing: boolean;
}

export function EventDetailDrawer({
  event,
  open,
  onClose,
  onReprocess,
  isReprocessing,
}: EventDetailDrawerProps) {
  if (!event) return null;

  return (
    <Drawer open={open} onClose={onClose} title="Event Detail">
      <div className="space-y-5">
        {/* Metadata */}
        <div className="space-y-3">
          <div className="flex items-center gap-2">
            <Badge variant="secondary">{event.source}</Badge>
            <Badge variant="outline">{event.type}</Badge>
            <Badge variant={event.processed ? "success" : "warning"}>
              {event.processed ? "Processed" : "Pending"}
            </Badge>
          </div>
          <p className="text-xs text-muted-foreground">{formatDate(event.createdAt)}</p>
          <p className="text-xs text-muted-foreground font-mono break-all">{event.id}</p>
        </div>

        {/* Result */}
        {event.result && (
          <div>
            <h3 className="text-sm font-medium mb-1">Result</h3>
            <p className="text-sm text-muted-foreground whitespace-pre-wrap">{event.result}</p>
          </div>
        )}

        {/* Payload */}
        <div>
          <h3 className="text-sm font-medium mb-1">Payload</h3>
          <pre className="rounded-md border bg-muted/50 p-3 text-xs overflow-auto max-h-96 font-mono">
            {JSON.stringify(event.payload, null, 2)}
          </pre>
        </div>

        {/* Reprocess button */}
        {(!event.processed || event.result?.startsWith("Error:")) && (
          <Button
            variant="outline"
            size="sm"
            onClick={() => onReprocess(event.id)}
            disabled={isReprocessing}
          >
            <RefreshCw className={`mr-1.5 h-3.5 w-3.5 ${isReprocessing ? "animate-spin" : ""}`} />
            {isReprocessing ? "Reprocessing..." : "Reprocess"}
          </Button>
        )}
      </div>
    </Drawer>
  );
}
