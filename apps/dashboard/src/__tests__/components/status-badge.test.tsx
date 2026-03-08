import { render, screen } from "@testing-library/react";
import {
  GoalStatusBadge,
  TaskStatusBadge,
  ApprovalStatusBadge,
} from "@/components/common/status-badge";

describe("GoalStatusBadge", () => {
  it.each([
    ["draft", "Draft"],
    ["active", "Active"],
    ["completed", "Completed"],
    ["cancelled", "Cancelled"],
  ] as const)("renders %s as %s", (status, label) => {
    render(<GoalStatusBadge status={status} />);
    expect(screen.getByText(label)).toBeInTheDocument();
  });
});

describe("TaskStatusBadge", () => {
  it.each([
    ["pending", "Pending"],
    ["assigned", "Assigned"],
    ["running", "Running"],
    ["completed", "Completed"],
    ["failed", "Failed"],
    ["cancelled", "Cancelled"],
  ] as const)("renders %s as %s", (status, label) => {
    render(<TaskStatusBadge status={status} />);
    expect(screen.getByText(label)).toBeInTheDocument();
  });
});

describe("ApprovalStatusBadge", () => {
  it.each([
    ["pending", "Pending"],
    ["approved", "Approved"],
    ["rejected", "Rejected"],
  ] as const)("renders %s as %s", (status, label) => {
    render(<ApprovalStatusBadge status={status} />);
    expect(screen.getByText(label)).toBeInTheDocument();
  });
});
