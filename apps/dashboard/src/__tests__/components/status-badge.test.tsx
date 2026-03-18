import { screen } from "@testing-library/react";
import {
  GoalStatusBadge,
  TaskStatusBadge,
  ApprovalStatusBadge,
} from "@/components/common/status-badge";
import { renderWithProviders } from "../test-utils";

describe("GoalStatusBadge", () => {
  it.each([
    ["draft", "Draft"],
    ["active", "Active"],
    ["completed", "Completed"],
    ["cancelled", "Cancelled"],
  ] as const)("renders %s as %s", (status, label) => {
    renderWithProviders(<GoalStatusBadge status={status} />);
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
    renderWithProviders(<TaskStatusBadge status={status} />);
    expect(screen.getByText(label)).toBeInTheDocument();
  });
});

describe("ApprovalStatusBadge", () => {
  it.each([
    ["pending", "Pending"],
    ["approved", "Approved"],
    ["rejected", "Rejected"],
  ] as const)("renders %s as %s", (status, label) => {
    renderWithProviders(<ApprovalStatusBadge status={status} />);
    expect(screen.getByText(label)).toBeInTheDocument();
  });
});
