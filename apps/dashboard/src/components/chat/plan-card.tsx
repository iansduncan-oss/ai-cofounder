import { useState } from "react";
import { ChevronDown, ChevronRight, Target } from "lucide-react";
import type { PlanInfo } from "@/hooks/use-stream-chat";

export function PlanCard({ plan }: { plan: PlanInfo }) {
  const [expanded, setExpanded] = useState(true);

  return (
    <div className="mt-2 rounded-md border bg-background/50 p-3">
      <button
        className="flex w-full items-center gap-2 text-left text-xs font-medium"
        onClick={() => setExpanded(!expanded)}
        aria-label={expanded ? "Collapse plan" : "Expand plan"}
      >
        {expanded ? (
          <ChevronDown className="h-3 w-3" />
        ) : (
          <ChevronRight className="h-3 w-3" />
        )}
        <Target className="h-3 w-3 text-primary" />
        <span>{plan.goalTitle}</span>
      </button>
      {expanded && (
        <div className="mt-2 space-y-1 pl-5">
          {plan.tasks
            .sort((a, b) => a.orderIndex - b.orderIndex)
            .map((task, i) => (
              <div
                key={task.id}
                className="flex items-center gap-2 text-xs text-muted-foreground"
              >
                <span className="flex h-4 w-4 shrink-0 items-center justify-center rounded-full bg-muted text-[10px] font-medium">
                  {i + 1}
                </span>
                <span>{task.title}</span>
                <span className="ml-auto text-[10px] opacity-60">
                  {task.assignedAgent}
                </span>
              </div>
            ))}
        </div>
      )}
    </div>
  );
}
