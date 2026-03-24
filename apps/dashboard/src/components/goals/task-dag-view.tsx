import { useCallback, useEffect, useMemo, useState } from "react";
import {
  ReactFlow,
  type Node,
  type Edge,
  type NodeProps,
  Position,
  Handle,
  useNodesState,
  useEdgesState,
  Background,
  BackgroundVariant,
} from "@xyflow/react";
import ELK from "elkjs/lib/elk.bundled.js";
import { TaskStatusBadge } from "@/components/common/status-badge";
import { Badge } from "@/components/ui/badge";
import type { Task, TaskStatus } from "@ai-cofounder/api-client";
import "@xyflow/react/dist/style.css";

const elk = new ELK();

const statusColors: Record<TaskStatus, string> = {
  pending: "border-muted-foreground/40",
  assigned: "border-yellow-500",
  running: "border-blue-500 shadow-blue-500/20 shadow-md",
  completed: "border-emerald-500",
  failed: "border-red-500",
  cancelled: "border-red-400/60",
  blocked: "border-yellow-600",
};

interface TaskNodeData {
  label: string;
  status: TaskStatus;
  agent?: string;
  index: number;
  [key: string]: unknown;
}

function TaskNode({ data }: NodeProps<Node<TaskNodeData>>) {
  return (
    <div
      className={`rounded-lg border-2 bg-card px-3 py-2 min-w-[180px] max-w-[260px] ${statusColors[data.status] ?? "border-border"}`}
    >
      <Handle type="target" position={Position.Top} className="!bg-muted-foreground !w-2 !h-2" />
      <div className="flex items-center gap-2 mb-1">
        <span className="flex h-5 w-5 shrink-0 items-center justify-center rounded-full bg-muted text-[10px] font-medium">
          {data.index + 1}
        </span>
        <p className="text-xs font-medium leading-tight truncate">{data.label}</p>
      </div>
      <div className="flex items-center gap-1.5">
        <TaskStatusBadge status={data.status} />
        {data.agent && (
          <Badge variant="outline" className="text-[10px] px-1 py-0">
            {data.agent}
          </Badge>
        )}
      </div>
      <Handle type="source" position={Position.Bottom} className="!bg-muted-foreground !w-2 !h-2" />
    </div>
  );
}

const nodeTypes = { task: TaskNode };

async function layoutGraph<T extends Record<string, unknown>>(nodes: Node<T>[], edges: Edge[]): Promise<{ nodes: Node<T>[]; edges: Edge[] }> {
  const graph = {
    id: "root",
    layoutOptions: {
      "elk.algorithm": "layered",
      "elk.direction": "DOWN",
      "elk.spacing.nodeNode": "40",
      "elk.layered.spacing.nodeNodeBetweenLayers": "60",
    },
    children: nodes.map((n) => ({
      id: n.id,
      width: 220,
      height: 70,
    })),
    edges: edges.map((e) => ({
      id: e.id,
      sources: [e.source],
      targets: [e.target],
    })),
  };

  const layout = await elk.layout(graph);

  return {
    nodes: nodes.map((node) => {
      const elkNode = layout.children?.find((n) => n.id === node.id);
      return {
        ...node,
        position: { x: elkNode?.x ?? 0, y: elkNode?.y ?? 0 },
      };
    }),
    edges,
  };
}

interface TaskDAGViewProps {
  tasks: Task[];
}

export function TaskDAGView({ tasks }: TaskDAGViewProps) {
  const [nodes, setNodes, onNodesChange] = useNodesState<Node<TaskNodeData>>([]);
  const [edges, setEdges, onEdgesChange] = useEdgesState<Edge>([]);
  const [layoutReady, setLayoutReady] = useState(false);

  const sorted = useMemo(
    () => [...tasks].sort((a, b) => a.orderIndex - b.orderIndex),
    [tasks],
  );

  const buildGraph = useCallback(async () => {
    const hasAnyDeps = sorted.some((t) => t.dependsOn && t.dependsOn.length > 0);

    const rawNodes: Node<TaskNodeData>[] = sorted.map((task, i) => ({
      id: task.id,
      type: "task",
      position: { x: 0, y: 0 },
      data: {
        label: task.title,
        status: task.status,
        agent: task.assignedAgent,
        index: i,
      },
    }));

    const rawEdges: Edge[] = [];

    if (hasAnyDeps) {
      for (const task of sorted) {
        if (task.dependsOn) {
          for (const depId of task.dependsOn) {
            rawEdges.push({
              id: `${depId}->${task.id}`,
              source: depId,
              target: task.id,
              animated: task.status === "running",
            });
          }
        }
      }
    } else {
      // Fallback: sequential chain
      for (let i = 1; i < sorted.length; i++) {
        rawEdges.push({
          id: `${sorted[i - 1].id}->${sorted[i].id}`,
          source: sorted[i - 1].id,
          target: sorted[i].id,
          animated: sorted[i].status === "running",
        });
      }
    }

    const result = await layoutGraph(rawNodes, rawEdges);
    setNodes(result.nodes);
    setEdges(result.edges);
    setLayoutReady(true);
  }, [sorted, setNodes, setEdges]);

  useEffect(() => {
    if (sorted.length > 0) {
      buildGraph();
    }
  }, [sorted, buildGraph]);

  if (sorted.length === 0) {
    return <p className="text-sm text-muted-foreground py-4">No tasks to visualize</p>;
  }

  if (!layoutReady) {
    return <div className="h-[400px] flex items-center justify-center text-sm text-muted-foreground">Laying out graph...</div>;
  }

  return (
    <div className="h-[400px] w-full rounded-md border bg-background">
      <ReactFlow
        nodes={nodes}
        edges={edges}
        onNodesChange={onNodesChange}
        onEdgesChange={onEdgesChange}
        nodeTypes={nodeTypes}
        fitView
        fitViewOptions={{ padding: 0.2 }}
        nodesDraggable={false}
        nodesConnectable={false}
        elementsSelectable={false}
        proOptions={{ hideAttribution: true }}
      >
        <Background variant={BackgroundVariant.Dots} gap={16} size={1} className="opacity-30" />
      </ReactFlow>
    </div>
  );
}
