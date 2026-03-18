import { useState } from "react";
import { useGmailInbox, useGmailMessage, useGmailSearch, useGmailUnreadCount } from "@/api/queries";
import { useSendGmailMessage, useMarkGmailRead } from "@/api/mutations";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Dialog, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Mail, Search, Send, ArrowLeft } from "lucide-react";

function ComposeDialog() {
  const [open, setOpen] = useState(false);
  const [to, setTo] = useState("");
  const [subject, setSubject] = useState("");
  const [body, setBody] = useState("");
  const sendMutation = useSendGmailMessage();

  const handleSend = () => {
    sendMutation.mutate({ to, subject, body }, {
      onSuccess: () => { setOpen(false); setTo(""); setSubject(""); setBody(""); },
    });
  };

  return (
    <>
      <Button size="sm" onClick={() => setOpen(true)}><Send className="mr-2 h-4 w-4" />Compose</Button>
      <Dialog open={open} onClose={() => setOpen(false)}>
        <DialogHeader><DialogTitle>Compose Email</DialogTitle></DialogHeader>
        <div className="space-y-3">
          <Input placeholder="To" value={to} onChange={(e) => setTo(e.target.value)} />
          <Input placeholder="Subject" value={subject} onChange={(e) => setSubject(e.target.value)} />
          <textarea
            className="w-full min-h-[120px] rounded-md border bg-background px-3 py-2 text-sm"
            placeholder="Message body..."
            value={body}
            onChange={(e) => setBody(e.target.value)}
          />
          <div className="flex justify-end gap-2">
            <Button variant="outline" onClick={() => setOpen(false)}>Cancel</Button>
            <Button onClick={handleSend} disabled={!to || !subject || sendMutation.isPending}>
              {sendMutation.isPending ? "Sending..." : "Send"}
            </Button>
          </div>
        </div>
      </Dialog>
    </>
  );
}

function MessageDetail({ messageId, onBack }: { messageId: string; onBack: () => void }) {
  const { data: message, isLoading } = useGmailMessage(messageId);
  const markRead = useMarkGmailRead();

  if (isLoading) return <div className="p-4 text-muted-foreground">Loading message...</div>;
  if (!message) return <div className="p-4 text-muted-foreground">Message not found</div>;

  // Render plain text body safely (no dangerouslySetInnerHTML to avoid XSS)
  const displayBody = message.body || (message.bodyHtml
    ? message.bodyHtml.replace(/<[^>]*>/g, " ").replace(/\s+/g, " ").trim()
    : "");

  return (
    <Card>
      <CardHeader>
        <div className="flex items-center gap-2">
          <Button variant="ghost" size="sm" onClick={onBack}><ArrowLeft className="h-4 w-4" /></Button>
          <div className="flex-1">
            <CardTitle className="text-base">{message.subject}</CardTitle>
            <p className="text-sm text-muted-foreground">From: {message.from} &middot; {message.date}</p>
            {message.to && <p className="text-xs text-muted-foreground">To: {message.to}</p>}
          </div>
          {message.isUnread && (
            <Button variant="outline" size="sm" onClick={() => markRead.mutate(messageId)}>Mark read</Button>
          )}
        </div>
      </CardHeader>
      <CardContent>
        <pre className="whitespace-pre-wrap text-sm font-sans">{displayBody}</pre>
        {message.attachments.length > 0 && (
          <div className="mt-4 border-t pt-3">
            <p className="text-xs font-medium text-muted-foreground mb-1">Attachments</p>
            {message.attachments.map((a, i) => (
              <Badge key={i} variant="secondary" className="mr-1">{a.filename}</Badge>
            ))}
          </div>
        )}
      </CardContent>
    </Card>
  );
}

export function GmailPage() {
  const [searchQuery, setSearchQuery] = useState("");
  const [activeSearch, setActiveSearch] = useState("");
  const [selectedId, setSelectedId] = useState<string | null>(null);

  const { data: inbox, isLoading } = useGmailInbox(20);
  const { data: unread } = useGmailUnreadCount();
  const { data: searchResults } = useGmailSearch(activeSearch);

  const messages = activeSearch ? searchResults?.messages : inbox?.messages;

  if (selectedId) {
    return (
      <div className="space-y-4">
        <MessageDetail messageId={selectedId} onBack={() => setSelectedId(null)} />
      </div>
    );
  }

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-3">
          <h1 className="text-2xl font-bold">Gmail</h1>
          {unread && unread.unreadCount > 0 && (
            <Badge variant="destructive">{unread.unreadCount} unread</Badge>
          )}
        </div>
        <ComposeDialog />
      </div>

      <div className="flex gap-2">
        <div className="relative flex-1">
          <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
          <Input
            className="pl-9"
            placeholder="Search emails..."
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            onKeyDown={(e) => { if (e.key === "Enter") setActiveSearch(searchQuery); }}
          />
        </div>
        {activeSearch && (
          <Button variant="outline" size="sm" onClick={() => { setActiveSearch(""); setSearchQuery(""); }}>Clear</Button>
        )}
      </div>

      {isLoading ? (
        <div className="space-y-2">
          {[...Array(5)].map((_, i) => (
            <div key={i} className="h-16 animate-pulse rounded-md bg-muted" />
          ))}
        </div>
      ) : !messages?.length ? (
        <Card>
          <CardContent className="flex flex-col items-center justify-center py-12 text-muted-foreground">
            <Mail className="h-10 w-10 mb-3" />
            <p>{activeSearch ? "No results found" : "No messages in inbox"}</p>
          </CardContent>
        </Card>
      ) : (
        <div className="space-y-1">
          {messages.map((msg) => (
            <button
              key={msg.id}
              onClick={() => setSelectedId(msg.id)}
              className="w-full text-left rounded-md border p-3 hover:bg-accent transition-colors flex items-start gap-3"
            >
              <div className="flex-1 min-w-0">
                <div className="flex items-center gap-2">
                  <span className={`text-sm truncate ${msg.isUnread ? "font-semibold" : "text-muted-foreground"}`}>
                    {msg.from}
                  </span>
                  <span className="text-xs text-muted-foreground ml-auto flex-shrink-0">{msg.date}</span>
                </div>
                <p className={`text-sm truncate ${msg.isUnread ? "font-medium" : ""}`}>{msg.subject}</p>
                <p className="text-xs text-muted-foreground truncate">{msg.snippet}</p>
              </div>
              <div className="flex items-center gap-1 flex-shrink-0">
                {msg.isUnread && <div className="h-2 w-2 rounded-full bg-blue-500" />}
                {msg.hasAttachments && <Badge variant="outline" className="text-[10px]">Att</Badge>}
              </div>
            </button>
          ))}
        </div>
      )}
    </div>
  );
}
