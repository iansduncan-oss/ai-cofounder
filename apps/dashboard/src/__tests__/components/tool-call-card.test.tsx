import { screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { ToolCallCard } from "@/components/chat/tool-call-card";
import type { ToolCallInfo } from "@/hooks/use-stream-chat";
import { renderWithProviders } from "../test-utils";

describe("ToolCallCard", () => {
  const completedTool: ToolCallInfo = {
    id: "tc-1",
    name: "search_web",
    input: { query: "test query" },
    result: "Found 3 results",
    isExecuting: false,
  };

  const executingTool: ToolCallInfo = {
    id: "tc-2",
    name: "read_file",
    input: { path: "/src/index.ts" },
    isExecuting: true,
  };

  it("renders tool name", () => {
    renderWithProviders(<ToolCallCard tool={completedTool} />);
    expect(screen.getByText("search_web")).toBeInTheDocument();
  });

  it("shows spinner when executing", () => {
    const { container } = renderWithProviders(<ToolCallCard tool={executingTool} />);
    expect(container.querySelector(".animate-spin")).toBeInTheDocument();
  });

  it("does not show spinner when completed", () => {
    const { container } = renderWithProviders(<ToolCallCard tool={completedTool} />);
    expect(container.querySelector(".animate-spin")).not.toBeInTheDocument();
  });

  it("expands to show input and result on click", async () => {
    renderWithProviders(<ToolCallCard tool={completedTool} />);

    expect(screen.queryByText(/"test query"/)).not.toBeInTheDocument();

    await userEvent.click(screen.getByText("search_web"));

    expect(screen.getByText(/"test query"/)).toBeInTheDocument();
    expect(screen.getByText("Found 3 results")).toBeInTheDocument();
  });

  it("collapses on second click", async () => {
    renderWithProviders(<ToolCallCard tool={completedTool} />);

    await userEvent.click(screen.getByText("search_web"));
    expect(screen.getByText(/"test query"/)).toBeInTheDocument();

    await userEvent.click(screen.getByText("search_web"));
    expect(screen.queryByText(/"test query"/)).not.toBeInTheDocument();
  });
});
