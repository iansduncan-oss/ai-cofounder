import { useMemo } from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";

interface HeatmapCell {
  day_of_week: number;
  hour_of_day: number;
  count: number;
}

interface ActivityHeatmapProps {
  data: HeatmapCell[];
}

const DAY_LABELS = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];

function getIntensityClass(count: number, max: number): string {
  if (count === 0 || max === 0) return "bg-muted";
  const ratio = count / max;
  if (ratio > 0.75) return "bg-indigo-600";
  if (ratio > 0.5) return "bg-indigo-500";
  if (ratio > 0.25) return "bg-indigo-400";
  return "bg-indigo-300";
}

export function ActivityHeatmap({ data }: ActivityHeatmapProps) {
  const { grid, max } = useMemo(() => {
    const g: number[][] = Array.from({ length: 7 }, () => Array(24).fill(0));
    let m = 0;
    for (const cell of data) {
      g[cell.day_of_week][cell.hour_of_day] = cell.count;
      if (cell.count > m) m = cell.count;
    }
    return { grid: g, max: m };
  }, [data]);

  return (
    <Card>
      <CardHeader className="pb-2">
        <CardTitle className="text-sm font-medium">Activity Heatmap</CardTitle>
      </CardHeader>
      <CardContent>
        <div className="overflow-x-auto">
          <div className="inline-grid gap-0.5" style={{ gridTemplateColumns: `auto repeat(24, minmax(0, 1fr))` }}>
            {/* Hour labels row */}
            <div />
            {Array.from({ length: 24 }, (_, h) => (
              <div key={`h-${h}`} className="text-center text-[10px] text-muted-foreground">
                {h % 6 === 0 ? `${h}` : ""}
              </div>
            ))}

            {/* Data rows */}
            {grid.map((row, day) => (
              <>
                <div key={`label-${day}`} className="flex items-center pr-1 text-[10px] text-muted-foreground">
                  {DAY_LABELS[day]}
                </div>
                {row.map((count, hour) => (
                  <div
                    key={`cell-${day}-${hour}`}
                    className={`h-3.5 w-3.5 rounded-sm ${getIntensityClass(count, max)}`}
                    title={`${DAY_LABELS[day]} ${hour}:00 — ${count} action${count !== 1 ? "s" : ""}`}
                  />
                ))}
              </>
            ))}
          </div>
        </div>
      </CardContent>
    </Card>
  );
}
