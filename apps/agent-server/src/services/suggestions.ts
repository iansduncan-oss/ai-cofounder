import { createLogger } from "@ai-cofounder/shared";
import type { Db } from "@ai-cofounder/db";
import { getTriggeredPatterns } from "@ai-cofounder/db";
import type { LlmRegistry } from "@ai-cofounder/llm";
import { gatherBriefingData } from "./briefing.js";

const logger = createLogger("suggestions");

export async function generateSuggestions(
  db: Db,
  registry: LlmRegistry,
  context: { userMessage: string; agentResponse: string; userId?: string },
): Promise<string[]> {
  try {
    let projectState: string;
    try {
      const data = await gatherBriefingData(db);
      const parts: string[] = [];
      if (data.activeGoals.length > 0) {
        parts.push(
          `Active goals: ${data.activeGoals.map((g) => `${g.title} (${g.progress})`).join(", ")}`,
        );
      }
      if (data.staleGoalCount > 0) {
        parts.push(`${data.staleGoalCount} stale goal(s) needing attention`);
      }
      if (data.pendingApprovalCount > 0) {
        parts.push(`${data.pendingApprovalCount} pending approval(s)`);
      }
      if (data.taskBreakdown.pending) {
        parts.push(`${data.taskBreakdown.pending} pending tasks`);
      }
      projectState = parts.length > 0 ? parts.join(". ") : "No active work.";
    } catch {
      projectState = "Project state unavailable.";
    }

    // Fetch triggered patterns if userId provided
    let patternContext = "";
    if (context.userId) {
      try {
        const now = new Date();
        const patterns = await getTriggeredPatterns(db, context.userId, {
          dayOfWeek: now.getDay(),
          hourOfDay: now.getHours(),
        });
        if (patterns.length > 0) {
          const patternDescs = patterns
            .map((p) => `- ${p.description} → suggested: "${p.suggestedAction}" (confidence: ${p.confidence}%)`)
            .join("\n");
          patternContext = `\n\nThe user has these known behavioral patterns that match the current time:\n${patternDescs}\nConsider these patterns when suggesting next actions. Pattern-based suggestions should be prioritized if relevant.`;
        }
      } catch {
        // Pattern lookup failures are non-fatal
      }
    }

    const response = await registry.complete("simple", {
      messages: [
        {
          role: "user",
          content: [
            {
              type: "text",
              text: `Given this conversation turn and project state, suggest 2-3 concise next actions the user could take. Each should be phrased as a direct instruction they could send as their next message. Return ONLY a JSON array of strings, no other text.

Project state: ${projectState}${patternContext}

User said: ${context.userMessage}

Agent responded: ${context.agentResponse.slice(0, 500)}`,
            },
          ],
        },
      ],
    });

    const text =
      response.content
        .filter((c): c is { type: "text"; text: string } => c.type === "text")
        .map((c) => c.text)
        .join("") || "";

    const match = text.match(/\[[\s\S]*\]/);
    if (!match) return [];

    const parsed = JSON.parse(match[0]);
    if (!Array.isArray(parsed)) return [];

    return parsed.filter((s): s is string => typeof s === "string").slice(0, 3);
  } catch (err) {
    logger.debug({ err }, "suggestion generation failed (non-fatal)");
    return [];
  }
}
