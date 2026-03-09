import { useState } from "react";
import { useSSE } from "@/hooks/use-sse";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Play, Loader2, CheckCircle, XCircle } from "lucide-react";

interface ExecutionPanelProps {
  goalId: string;
  goalStatus: string;
}

interface TaskEvent {
  type?: string;
  status?: string;
  taskId?: string;
  taskTitle?: string;
  agent?: string;
  output?: string;
  error?: string;
  completedTasks?: number;
  totalTasks?: number;
}

export function ExecutionPanel({ goalId, goalStatus }: ExecutionPanelProps) {
  const [activeGoalId, setActiveGoalId] = useState<string | null>(null);
  const { events, isConnected, error } = useSSE(activeGoalId);

  const canExecute = goalStatus === "active" || goalStatus === "draft";
  const isRunning = isConnected;

  const handleExecute = () => {
    setActiveGoalId(goalId);
  };

  const taskEvents = events as TaskEvent[];
  const lastEvent = taskEvents[taskEvents.length - 1];
  const isCompleted = lastEvent?.status === "completed";
  const isFailed = lastEvent?.status === "failed";

  return (
    <Card>
      <CardHeader className="flex flex-row items-center justify-between">
        <CardTitle className="text-base">Execution</CardTitle>
        {!isRunning && canExecute && (
          <Button size="sm" onClick={handleExecute}>
            <Play className="mr-1 h-3 w-3" />
            Execute
          </Button>
        )}
        {isRunning && (
          <Badge variant="default">
            <Loader2 className="mr-1 h-3 w-3 animate-spin" />
            Running
          </Badge>
        )}
        {isCompleted && <Badge variant="success">Completed</Badge>}
        {isFailed && <Badge variant="destructive">Failed</Badge>}
      </CardHeader>
      <CardContent>
        {error && (
          <p className="text-sm text-destructive">{error}</p>
        )}
        {taskEvents.length === 0 && !isRunning && (
          <p className="text-sm text-muted-foreground">
            Click Execute to start running this goal's tasks
          </p>
        )}
        {taskEvents.length > 0 && (
          <div className="space-y-2">
            {lastEvent?.totalTasks && (
              <div className="mb-3">
                <div className="flex justify-between text-xs text-muted-foreground mb-1">
                  <span>Progress</span>
                  <span>
                    {lastEvent.completedTasks ?? 0}/{lastEvent.totalTasks}
                  </span>
                </div>
                <div className="h-2 rounded-full bg-muted">
                  <div
                    className="h-2 rounded-full bg-primary transition-all"
                    style={{
                      width: `${
                        ((lastEvent.completedTasks ?? 0) /
                          lastEvent.totalTasks) *
                        100
                      }%`,
                    }}
                  />
                </div>
              </div>
            )}
            {taskEvents.map((event, i) => (
              <div
                key={i}
                className="flex items-start gap-2 rounded-md border p-2 text-sm"
              >
                {event.status === "completed" ? (
                  <CheckCircle className="mt-0.5 h-4 w-4 shrink-0 text-emerald-500" />
                ) : event.status === "failed" ? (
                  <XCircle className="mt-0.5 h-4 w-4 shrink-0 text-destructive" />
                ) : (
                  <Loader2 className="mt-0.5 h-4 w-4 shrink-0 animate-spin text-primary" />
                )}
                <div className="flex-1 min-w-0">
                  <p className="font-medium">
                    {event.taskTitle ?? event.type ?? "Update"}
                  </p>
                  {event.agent && (
                    <p className="text-xs text-muted-foreground">
                      Agent: {event.agent}
                    </p>
                  )}
                  {event.output && (
                    <p className="mt-1 text-xs text-muted-foreground line-clamp-3">
                      {event.output}
                    </p>
                  )}
                  {event.error && (
                    <p className="mt-1 text-xs text-destructive">
                      {event.error}
                    </p>
                  )}
                </div>
              </div>
            ))}
          </div>
        )}
      </CardContent>
    </Card>
  );
}
