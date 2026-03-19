import { createLogger } from "@ai-cofounder/shared";
import type { Db } from "@ai-cofounder/db";
import {
  getMeetingPrep,
  upsertMeetingPrep,
  listUnnotifiedMeetingPreps,
  markMeetingPrepNotified,
  recallMemories,
} from "@ai-cofounder/db";
import type { LlmRegistry, EmbeddingService } from "@ai-cofounder/llm";
import { CalendarService, type CalendarEventSummary } from "./calendar.js";
import type { NotificationService } from "./notifications.js";

const logger = createLogger("meeting-prep");

export class MeetingPrepService {
  constructor(
    private db: Db,
    private llmRegistry: LlmRegistry,
    private embeddingService?: EmbeddingService,
  ) {}

  /**
   * Fetch upcoming 24h calendar events and generate prep for each one
   * that doesn't already have a prep.
   */
  async generateUpcomingPreps(adminUserId: string): Promise<number> {
    const cal = new CalendarService(this.db, adminUserId);
    const now = new Date();
    const dayLater = new Date(now.getTime() + 24 * 60 * 60 * 1000);

    let events: CalendarEventSummary[];
    try {
      events = await cal.listEvents({
        timeMin: now.toISOString(),
        timeMax: dayLater.toISOString(),
        maxResults: 20,
      });
    } catch (err) {
      logger.warn({ err }, "Failed to fetch calendar events for meeting prep");
      return 0;
    }

    let count = 0;
    for (const event of events) {
      const existing = await getMeetingPrep(this.db, event.id);
      if (existing) continue;

      try {
        await this.generatePrepForEvent(event, adminUserId);
        count++;
      } catch (err) {
        logger.warn({ err, eventId: event.id }, "Failed to generate prep for event");
      }
    }

    logger.info({ count, totalEvents: events.length }, "Generated meeting preps");
    return count;
  }

  /**
   * Generate AI-powered preparation notes for a single calendar event.
   */
  async generatePrepForEvent(event: CalendarEventSummary, adminUserId: string): Promise<void> {
    // Recall relevant memories (attendees, topic keywords)
    const searchTerms = [event.summary];
    const memories = await recallMemories(this.db, searchTerms.join(" "), adminUserId, 5);

    const memoryContext = memories.length > 0
      ? memories.map((m) => `- ${m.key}: ${m.value}`).join("\n")
      : "No relevant memories found.";

    const prompt = `You are a meeting preparation assistant. Generate concise preparation notes for the following meeting.

Meeting: ${event.summary}
Time: ${event.start} — ${event.end}
Location: ${event.location ?? "Not specified"}
Attendees: ${event.attendeeCount > 0 ? `${event.attendeeCount} attendees` : "Not specified"}

Relevant context from memory:
${memoryContext}

Generate a brief prep document with:
1. Key talking points
2. Relevant context from memories (if any)
3. Suggested questions or agenda items
4. Any preparation reminders

Keep it concise and actionable.`;

    const response = await this.llmRegistry.complete([
      { role: "user", content: prompt },
    ], "conversation");

    const prepText = typeof response.content === "string"
      ? response.content
      : response.content
        .filter((b): b is { type: "text"; text: string } => b.type === "text")
        .map((b) => b.text)
        .join("\n");

    await upsertMeetingPrep(this.db, {
      eventId: event.id,
      eventTitle: event.summary,
      eventStart: new Date(event.start),
      prepText,
      attendees: event.attendeeCount > 0 ? { count: event.attendeeCount } : null,
      relatedMemories: memories.length > 0
        ? memories.map((m) => ({ key: m.key, value: m.value }))
        : null,
    });

    logger.info({ eventId: event.id, eventTitle: event.summary }, "Meeting prep generated");
  }

  /**
   * Send notifications for preps whose events start within 30 minutes.
   */
  async sendPrepNotifications(notificationService: NotificationService): Promise<number> {
    const preps = await listUnnotifiedMeetingPreps(this.db);
    let count = 0;

    for (const prep of preps) {
      try {
        const minutesUntil = Math.round(
          (new Date(prep.eventStart).getTime() - Date.now()) / 60_000,
        );
        await notificationService.sendBriefing(
          `**Meeting in ${minutesUntil} min: ${prep.eventTitle}**\n\n${prep.prepText}`,
        );
        await markMeetingPrepNotified(this.db, prep.id);
        count++;
      } catch (err) {
        logger.warn({ err, prepId: prep.id }, "Failed to send meeting prep notification");
      }
    }

    if (count > 0) {
      logger.info({ count }, "Sent meeting prep notifications");
    }
    return count;
  }
}
