import { createLogger } from "@ai-cofounder/shared";
import type { Db } from "@ai-cofounder/db";
import { getTriggeredPatterns, incrementPatternHitCount } from "@ai-cofounder/db";
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
          `Active goals: ${data.activeGoals.map((g) => `${g.title} (${g.progress}, ${g.hoursStale}h since update)`).join(", ")}`,
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
      if (data.completedYesterday.length > 0) {
        parts.push(`Recently completed: ${data.completedYesterday.map((g) => g.title).join(", ")}`);
      }
      if (data.recentSessions.length > 0) {
        const lastSession = data.recentSessions[0];
        parts.push(`Last session: ${lastSession.trigger} (${lastSession.status})`);
      }
      if (data.unreadEmailCount && data.unreadEmailCount > 0) {
        parts.push(`${data.unreadEmailCount} unread email(s)`);
      }
      if (data.todayEvents && data.todayEvents.length > 0) {
        parts.push(`Today's meetings: ${data.todayEvents.map((e) => e.summary).join(", ")}`);
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
          for (const p of patterns) {
            incrementPatternHitCount(db, p.id).catch((err) =>
              logger.warn({ err }, "pattern hit count increment failed"),
            );
          }
          const patternDescs = patterns
            .map(
              (p) =>
                `- ${p.description} → suggested: "${p.suggestedAction}" (confidence: ${p.confidence}%)`,
            )
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
              text: `Given this conversation turn and project state, suggest 2-3 specific next actions the user could take.

Rules:
- Each should be phrased as a natural message they could send in chat (not a button label)
- Be SPECIFIC: reference actual goal names, email subjects, meeting names, recent events
- Good: "How did the deploy from 2 hours ago go?" Bad: "Run monitoring check"
- Good: "Pull up that pricing discussion from last week" Bad: "Search my memories"
- If there are pending approvals, suggest reviewing them
- If goals are stale, suggest checking on the specific goal by name
- Match the conversation's topic for at least one suggestion
- Return ONLY a JSON array of strings, no other text

Current time: ${new Date().toLocaleString("en-US", { hour: "numeric", minute: "2-digit", weekday: "short" })}
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
