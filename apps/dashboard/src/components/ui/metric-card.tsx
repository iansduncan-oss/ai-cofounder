import { type ReactNode } from "react";
import { cn } from "@/lib/utils";
import { TrendingUp, TrendingDown, Minus } from "lucide-react";

interface MetricCardProps {
  label: string;
  value: string | number;
  icon?: ReactNode;
  trend?: "up" | "down" | "flat";
  status?: "ok" | "warning" | "critical" | "unknown";
  className?: string;
}

const statusColors: Record<string, string> = {
  ok: "bg-emerald-500",
  warning: "bg-amber-500",
  critical: "bg-red-500",
  unknown: "bg-gray-400",
};

const trendIcons: Record<string, ReactNode> = {
  up: <TrendingUp className="h-3 w-3 text-emerald-400" />,
  down: <TrendingDown className="h-3 w-3 text-red-400" />,
  flat: <Minus className="h-3 w-3 text-muted-foreground" />,
};

export function MetricCard({ label, value, icon, trend, status, className }: MetricCardProps) {
  return (
    <div
      className={cn(
        "flex items-center gap-3 rounded-lg border bg-surface-1 px-3 py-2",
        className,
      )}
    >
      {icon && <span className="text-muted-foreground shrink-0">{icon}</span>}
      <div className="flex-1 min-w-0">
        <p className="text-[10px] uppercase tracking-wider text-muted-foreground truncate">{label}</p>
        <p className="font-metric text-lg font-bold leading-tight">{value}</p>
      </div>
      <div className="flex flex-col items-center gap-1 shrink-0">
        {status && <div className={cn("h-2 w-2 rounded-full", statusColors[status])} />}
        {trend && trendIcons[trend]}
      </div>
    </div>
  );
}
