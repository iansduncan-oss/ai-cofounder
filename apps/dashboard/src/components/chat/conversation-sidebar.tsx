import { useState } from "react";
import { useConversations } from "@/api/queries";
import { formatRelativeTime } from "@/lib/utils";
import { cn } from "@/lib/utils";
import { MessageSquare, Plus, PanelLeftClose, PanelLeft } from "lucide-react";

interface ConversationSidebarProps {
  userId: string | undefined;
  activeConversationId: string | undefined;
  onSelect: (id: string) => void;
  onNewChat: () => void;
}

export function ConversationSidebar({
  userId,
  activeConversationId,
  onSelect,
  onNewChat,
}: ConversationSidebarProps) {
  const [collapsed, setCollapsed] = useState(false);
  const { data } = useConversations(userId);

  if (collapsed) {
    return (
      <div className="flex flex-col items-center border-r bg-card py-2 px-1">
        <button
          onClick={() => setCollapsed(false)}
          className="rounded-md p-1.5 text-muted-foreground hover:bg-accent hover:text-accent-foreground transition-colors"
          aria-label="Expand sidebar"
        >
          <PanelLeft className="h-4 w-4" />
        </button>
        <button
          onClick={onNewChat}
          className="mt-2 rounded-md p-1.5 text-muted-foreground hover:bg-accent hover:text-accent-foreground transition-colors"
          aria-label="New chat"
        >
          <Plus className="h-4 w-4" />
        </button>
      </div>
    );
  }

  const conversations = data?.data ?? [];

  return (
    <div className="hidden w-64 flex-col border-r bg-card md:flex">
      <div className="flex items-center justify-between border-b px-3 py-2">
        <span className="text-xs font-semibold">Conversations</span>
        <div className="flex gap-1">
          <button
            onClick={onNewChat}
            className="rounded-md p-1 text-muted-foreground hover:bg-accent hover:text-accent-foreground transition-colors"
            aria-label="New chat"
          >
            <Plus className="h-3.5 w-3.5" />
          </button>
          <button
            onClick={() => setCollapsed(true)}
            className="rounded-md p-1 text-muted-foreground hover:bg-accent hover:text-accent-foreground transition-colors"
            aria-label="Collapse sidebar"
          >
            <PanelLeftClose className="h-3.5 w-3.5" />
          </button>
        </div>
      </div>

      <div className="flex-1 overflow-y-auto" role="region" aria-label="Conversations">
        {conversations.length === 0 ? (
          <div className="px-3 py-6 text-center text-xs text-muted-foreground">
            No conversations yet
          </div>
        ) : (
          <div className="py-1">
            {conversations.map((conv) => (
              <button
                key={conv.id}
                onClick={() => onSelect(conv.id)}
                aria-current={conv.id === activeConversationId ? "true" : undefined}
                className={cn(
                  "flex w-full items-start gap-2 px-3 py-2 text-left text-xs transition-colors hover:bg-accent",
                  conv.id === activeConversationId && "bg-accent",
                )}
              >
                <MessageSquare className="mt-0.5 h-3 w-3 shrink-0 text-muted-foreground" aria-hidden="true" />
                <div className="min-w-0 flex-1">
                  <p className="truncate font-medium">
                    {conv.title || `Chat ${conv.id.slice(0, 8)}...`}
                  </p>
                  <p className="mt-0.5 text-muted-foreground">
                    {formatRelativeTime(conv.updatedAt)}
                  </p>
                </div>
              </button>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
