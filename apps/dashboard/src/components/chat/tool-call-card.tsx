import { useState } from "react";
import { ChevronDown, ChevronRight, Loader2, Wrench, Check } from "lucide-react";
import type { ToolCallInfo } from "@/hooks/use-stream-chat";

export function ToolCallCard({ tool }: { tool: ToolCallInfo }) {
  const [expanded, setExpanded] = useState(false);

  return (
    <div className="my-1 rounded-md border bg-background/50 text-xs">
      <button
        className="flex w-full items-center gap-2 px-3 py-1.5 text-left"
        onClick={() => setExpanded(!expanded)}
      >
        {tool.isExecuting ? (
          <Loader2 className="h-3 w-3 animate-spin text-primary" />
        ) : expanded ? (
          <ChevronDown className="h-3 w-3" />
        ) : (
          <ChevronRight className="h-3 w-3" />
        )}
        <Wrench className="h-3 w-3 text-muted-foreground" />
        <span className="font-medium">{tool.name}</span>
        {!tool.isExecuting && (
          <Check className="ml-auto h-3 w-3 text-green-500" />
        )}
      </button>
      {expanded && (
        <div className="border-t px-3 py-2 space-y-1">
          {Object.keys(tool.input).length > 0 && (
            <div>
              <span className="text-muted-foreground">Input: </span>
              <pre className="mt-0.5 max-h-32 overflow-auto rounded bg-muted p-1.5 text-[10px]">
                {JSON.stringify(tool.input, null, 2)}
              </pre>
            </div>
          )}
          {tool.result && (
            <div>
              <span className="text-muted-foreground">Result: </span>
              <pre className="mt-0.5 max-h-32 overflow-auto rounded bg-muted p-1.5 text-[10px]">
                {tool.result}
              </pre>
            </div>
          )}
        </div>
      )}
    </div>
  );
}
