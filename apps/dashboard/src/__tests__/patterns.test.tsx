import { describe, it, expect, vi } from "vitest";
import { render } from "@testing-library/react";
import { ActivityHeatmap } from "../components/patterns/activity-heatmap";

// Mock recharts to avoid canvas issues in jsdom
vi.mock("recharts", () => ({
  ResponsiveContainer: ({ children }: { children?: React.ReactNode }) => <div>{children}</div>,
  BarChart: ({ children }: { children?: React.ReactNode }) => <div>{children}</div>,
  Bar: () => null,
  XAxis: () => null,
  YAxis: () => null,
  Tooltip: () => null,
  PieChart: ({ children }: { children?: React.ReactNode }) => <div>{children}</div>,
  Pie: () => null,
  Cell: () => null,
}));

describe("ActivityHeatmap", () => {
  it("renders 168 cells (7 days x 24 hours)", () => {
    const data = [
      { day_of_week: 0, hour_of_day: 10, count: 5 },
      { day_of_week: 3, hour_of_day: 14, count: 12 },
    ];

    const { container } = render(<ActivityHeatmap data={data} />);

    // Each cell has a title attribute with day/hour info
    const cells = container.querySelectorAll("[title]");
    // 168 data cells (7 * 24)
    expect(cells.length).toBe(168);
  });

  it("shows correct tooltip text", () => {
    const data = [{ day_of_week: 1, hour_of_day: 10, count: 14 }];

    const { container } = render(<ActivityHeatmap data={data} />);

    const cell = container.querySelector('[title="Mon 10:00 — 14 actions"]');
    expect(cell).toBeTruthy();
  });

  it("renders with empty data", () => {
    const { container } = render(<ActivityHeatmap data={[]} />);

    const cells = container.querySelectorAll("[title]");
    expect(cells.length).toBe(168);
  });
});
