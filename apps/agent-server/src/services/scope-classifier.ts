import type { GoalScope } from "@ai-cofounder/shared";

const SCOPE_ORDER: GoalScope[] = ["read_only", "local", "external", "destructive"];

const DESTRUCTIVE_KEYWORDS = [
  "delete", "remove", "drop", "destroy", "wipe", "purge", "truncate",
  "force push", "reset --hard", "rm -rf", "uninstall",
];

const EXTERNAL_KEYWORDS = [
  "send", "email", "deploy", "push", "publish", "post", "tweet",
  "notify", "broadcast", "webhook", "calendar", "invite", "message",
  "slack", "discord", "sms", "release",
];

const LOCAL_AGENTS = new Set(["coder", "debugger", "reviewer"]);

export function maxScope(a: GoalScope, b: GoalScope): GoalScope {
  const ai = SCOPE_ORDER.indexOf(a);
  const bi = SCOPE_ORDER.indexOf(b);
  return ai >= bi ? a : b;
}

export function scopeRequiresApproval(scope: GoalScope): boolean {
  return scope === "external" || scope === "destructive";
}

interface TaskInput {
  description: string;
  assigned_agent: string;
}

export function classifyGoalScope(
  tasks: TaskInput[],
  llmScope?: GoalScope,
): GoalScope {
  let serverScope: GoalScope = "read_only";

  for (const task of tasks) {
    const desc = task.description.toLowerCase();

    // Check destructive first (highest priority)
    if (DESTRUCTIVE_KEYWORDS.some((kw) => desc.includes(kw))) {
      serverScope = maxScope(serverScope, "destructive");
      break; // Can't go higher
    }

    // Check external
    if (EXTERNAL_KEYWORDS.some((kw) => desc.includes(kw))) {
      serverScope = maxScope(serverScope, "external");
    }

    // Infer local for code-writing agents
    if (LOCAL_AGENTS.has(task.assigned_agent)) {
      serverScope = maxScope(serverScope, "local");
    }
  }

  // LLM can only escalate, never downgrade
  if (llmScope) {
    return maxScope(serverScope, llmScope);
  }

  return serverScope;
}
