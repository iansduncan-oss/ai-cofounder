import { findOrCreateUser, createConversation, type Db } from "@ai-cofounder/db";

/**
 * Resolve a user + conversation context from a userId and platform.
 * Creates the user if needed, creates a conversation if none provided.
 */
export async function resolveUserContext(
  db: Db,
  userId: string,
  platform: string,
  conversationId?: string,
  workspaceId?: string,
): Promise<{ dbUserId: string; conversationId: string }> {
  const user = await findOrCreateUser(db, userId, platform);
  const convId = conversationId ?? (await createConversation(db, { userId: user.id, workspaceId: workspaceId ?? "" })).id;
  return { dbUserId: user.id, conversationId: convId };
}
