import type { CreatePlanInput } from "./tool-definitions.js";

/**
 * Validate that a dependency graph (expressed as zero-based task indices) has no cycles.
 * Uses Kahn's algorithm for topological sort — if not all nodes are visited, a cycle exists.
 */
export function validateDependencyGraph(tasks: CreatePlanInput["tasks"]): void {
  const n = tasks.length;
  const inDegree = new Array<number>(n).fill(0);
  const adj = new Array<number[]>(n);
  for (let i = 0; i < n; i++) adj[i] = [];

  for (let i = 0; i < n; i++) {
    const deps = tasks[i].depends_on;
    if (!deps) continue;
    for (const dep of deps) {
      if (dep < 0 || dep >= n || dep === i) {
        throw new Error(`Task ${i} has invalid dependency index ${dep}`);
      }
      adj[dep].push(i);
      inDegree[i]++;
    }
  }

  // Kahn's algorithm
  const queue: number[] = [];
  for (let i = 0; i < n; i++) {
    if (inDegree[i] === 0) queue.push(i);
  }

  let visited = 0;
  while (queue.length > 0) {
    const node = queue.shift()!;
    visited++;
    for (const neighbor of adj[node]) {
      inDegree[neighbor]--;
      if (inDegree[neighbor] === 0) queue.push(neighbor);
    }
  }

  if (visited < n) {
    throw new Error("Dependency cycle detected in task graph");
  }
}
