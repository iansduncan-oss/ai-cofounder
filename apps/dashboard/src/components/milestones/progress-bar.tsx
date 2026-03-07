import { useMilestoneProgress } from "@/api/queries";

export function MilestoneProgressBar({ milestoneId }: { milestoneId: string }) {
  const { data: progress } = useMilestoneProgress(milestoneId);

  if (!progress || progress.totalTasks === 0) return null;

  const pct = Math.round(progress.percentComplete);

  return (
    <div className="mt-2 ml-6">
      <div className="flex items-center gap-2">
        <div className="h-1.5 flex-1 rounded-full bg-muted overflow-hidden">
          <div
            className="h-full rounded-full bg-primary transition-all duration-500"
            style={{ width: `${pct}%` }}
          />
        </div>
        <span className="text-xs text-muted-foreground tabular-nums">
          {progress.completedTasks}/{progress.totalTasks} tasks ({pct}%)
        </span>
      </div>
    </div>
  );
}
