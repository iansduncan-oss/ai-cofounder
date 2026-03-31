import { createLogger } from "@ai-cofounder/shared";
import type { Db } from "@ai-cofounder/db";
import { createConversation, getConversation, getConversationMessages, createMessage, conversations } from "@ai-cofounder/db";
import { eq } from "drizzle-orm";

const logger = createLogger("conversation-branching");

export class ConversationBranchingService {
  constructor(private db: Db) {}

  async branch(
    conversationId: string,
    userId: string,
    branchPointMessageId?: string,
  ): Promise<{ id: string; messagesCopied: number }> {
    // Look up original conversation's workspaceId
    const original = await getConversation(this.db, conversationId);
    const workspaceId = original?.workspaceId ?? "";

    // Create new conversation with branch metadata
    const conv = await createConversation(this.db, {
      userId,
      title: undefined,
      workspaceId,
    });

    // Update with branch info
    await this.db.update(conversations).set({
      parentConversationId: conversationId,
      branchPointMessageId: branchPointMessageId ?? null,
    }).where(eq(conversations.id, conv.id));

    // Copy messages up to branch point
    const history = await getConversationMessages(this.db, conversationId, 200);
    let messagesToCopy = history;

    if (branchPointMessageId) {
      const idx = history.findIndex((m) => m.id === branchPointMessageId);
      if (idx >= 0) {
        messagesToCopy = history.slice(0, idx + 1);
      }
    }

    for (const msg of messagesToCopy) {
      await createMessage(this.db, {
        conversationId: conv.id,
        role: msg.role as "user" | "agent" | "system",
        agentRole: msg.agentRole ?? undefined,
        content: msg.content,
      });
    }

    logger.info({ parentId: conversationId, branchId: conv.id, messagesCopied: messagesToCopy.length }, "conversation branched");

    return { id: conv.id, messagesCopied: messagesToCopy.length };
  }
}
