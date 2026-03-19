import { useState } from "react";
import { useCalendarEvents, useCalendarEvent, useCalendarSearch, useMeetingPrep } from "@/api/queries";
import { useCreateCalendarEvent, useDeleteCalendarEvent, useRespondToCalendarEvent } from "@/api/mutations";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Dialog, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Calendar, Search, Plus, ArrowLeft, Trash2, Brain, RefreshCw, Loader2, Clock } from "lucide-react";
import { cn } from "@/lib/utils";

function formatEventTime(start: string, end: string, isAllDay: boolean) {
  if (isAllDay) return "All day";
  try {
    const s = new Date(start);
    const e = new Date(end);
    const dateStr = s.toLocaleDateString(undefined, { weekday: "short", month: "short", day: "numeric" });
    const startTime = s.toLocaleTimeString(undefined, { hour: "numeric", minute: "2-digit" });
    const endTime = e.toLocaleTimeString(undefined, { hour: "numeric", minute: "2-digit" });
    return `${dateStr}, ${startTime} - ${endTime}`;
  } catch {
    return `${start} - ${end}`;
  }
}

function CreateEventDialog() {
  const [open, setOpen] = useState(false);
  const [summary, setSummary] = useState("");
  const [start, setStart] = useState("");
  const [end, setEnd] = useState("");
  const [description, setDescription] = useState("");
  const [location, setLocation] = useState("");
  const createMutation = useCreateCalendarEvent();

  const handleCreate = () => {
    createMutation.mutate({ summary, start, end, description: description || undefined, location: location || undefined }, {
      onSuccess: () => { setOpen(false); setSummary(""); setStart(""); setEnd(""); setDescription(""); setLocation(""); },
    });
  };

  return (
    <>
      <Button size="sm" onClick={() => setOpen(true)}><Plus className="mr-2 h-4 w-4" />New Event</Button>
      <Dialog open={open} onClose={() => setOpen(false)}>
        <DialogHeader><DialogTitle>Create Event</DialogTitle></DialogHeader>
        <div className="space-y-3">
          <Input placeholder="Event title" value={summary} onChange={(e) => setSummary(e.target.value)} />
          <div className="grid grid-cols-2 gap-2">
            <div>
              <label className="text-xs text-muted-foreground">Start</label>
              <Input type="datetime-local" value={start} onChange={(e) => setStart(e.target.value)} />
            </div>
            <div>
              <label className="text-xs text-muted-foreground">End</label>
              <Input type="datetime-local" value={end} onChange={(e) => setEnd(e.target.value)} />
            </div>
          </div>
          <Input placeholder="Location (optional)" value={location} onChange={(e) => setLocation(e.target.value)} />
          <textarea
            className="w-full min-h-[80px] rounded-md border bg-background px-3 py-2 text-sm"
            placeholder="Description (optional)"
            value={description}
            onChange={(e) => setDescription(e.target.value)}
          />
          <div className="flex justify-end gap-2">
            <Button variant="outline" onClick={() => setOpen(false)}>Cancel</Button>
            <Button onClick={handleCreate} disabled={!summary || !start || !end || createMutation.isPending}>
              {createMutation.isPending ? "Creating..." : "Create"}
            </Button>
          </div>
        </div>
      </Dialog>
    </>
  );
}

function MeetingPrepCard({ eventId }: { eventId: string }) {
  const { data, isLoading, error, refetch } = useMeetingPrep(eventId);
  const [hasRequested, setHasRequested] = useState(false);

  const handleGenerate = () => {
    setHasRequested(true);
    refetch();
  };

  if (!hasRequested && !data) {
    return (
      <Card>
        <CardHeader className="pb-3">
          <CardTitle className="flex items-center gap-2 text-sm font-medium">
            <Brain className="h-4 w-4" />
            Meeting Prep
          </CardTitle>
        </CardHeader>
        <CardContent>
          <p className="mb-3 text-sm text-muted-foreground">
            Generate AI-powered prep notes for this meeting, including attendee context and related memories.
          </p>
          <Button size="sm" onClick={handleGenerate}>
            <Brain className="mr-2 h-4 w-4" />
            Generate Prep
          </Button>
        </CardContent>
      </Card>
    );
  }

  if (isLoading) {
    return (
      <Card>
        <CardHeader className="pb-3">
          <CardTitle className="flex items-center gap-2 text-sm font-medium">
            <Brain className="h-4 w-4" />
            Meeting Prep
          </CardTitle>
        </CardHeader>
        <CardContent>
          <div className="flex items-center gap-2 text-sm text-muted-foreground">
            <Loader2 className="h-4 w-4 animate-spin" />
            Generating meeting prep...
          </div>
        </CardContent>
      </Card>
    );
  }

  if (error) {
    return (
      <Card>
        <CardHeader className="pb-3">
          <CardTitle className="flex items-center gap-2 text-sm font-medium">
            <Brain className="h-4 w-4" />
            Meeting Prep
          </CardTitle>
        </CardHeader>
        <CardContent>
          <p className="text-sm text-destructive">
            Failed to generate prep notes.{" "}
            <button onClick={handleGenerate} className="underline hover:no-underline">
              Try again
            </button>
          </p>
        </CardContent>
      </Card>
    );
  }

  if (!data) return null;

  return (
    <Card>
      <CardHeader className="pb-3">
        <CardTitle className="flex items-center justify-between text-sm font-medium">
          <span className="flex items-center gap-2">
            <Brain className="h-4 w-4" />
            Meeting Prep
          </span>
          <button
            onClick={handleGenerate}
            className="flex items-center gap-1 rounded-md px-2 py-1 text-xs text-muted-foreground hover:bg-muted hover:text-foreground transition-colors"
          >
            <RefreshCw className={cn("h-3.5 w-3.5", isLoading && "animate-spin")} />
            Refresh
          </button>
        </CardTitle>
      </CardHeader>
      <CardContent className="space-y-3">
        <div className="prose prose-sm dark:prose-invert max-w-none whitespace-pre-wrap text-sm">
          {data.prepText}
        </div>

        {Array.isArray(data.relatedMemories) && data.relatedMemories.length > 0 && (
          <div>
            <p className="mb-1 text-xs font-semibold uppercase text-muted-foreground">Related Memories</p>
            <ul className="ml-4 list-disc space-y-1 text-sm">
              {(data.relatedMemories as Array<{ content: string }>).map((m, i) => (
                <li key={i}>{m.content}</li>
              ))}
            </ul>
          </div>
        )}

        <div className="flex items-center gap-1 text-xs text-muted-foreground">
          <Clock className="h-3 w-3" />
          Generated at {new Date(data.generatedAt).toLocaleTimeString()}
        </div>
      </CardContent>
    </Card>
  );
}

function EventDetail({ eventId, onBack }: { eventId: string; onBack: () => void }) {
  const { data: event, isLoading } = useCalendarEvent(eventId);
  const deleteMutation = useDeleteCalendarEvent();
  const respondMutation = useRespondToCalendarEvent();

  if (isLoading) return <div className="p-4 text-muted-foreground">Loading event...</div>;
  if (!event) return <div className="p-4 text-muted-foreground">Event not found</div>;

  const isAllDay = !!event.start.date && !event.start.dateTime;
  const startStr = event.start.dateTime ?? event.start.date ?? "";
  const endStr = event.end.dateTime ?? event.end.date ?? "";

  return (
    <div className="space-y-4">
      <Card>
        <CardHeader>
          <div className="flex items-center gap-2">
            <Button variant="ghost" size="sm" onClick={onBack}><ArrowLeft className="h-4 w-4" /></Button>
            <div className="flex-1">
              <CardTitle className="text-base">{event.summary}</CardTitle>
              <p className="text-sm text-muted-foreground">{formatEventTime(startStr, endStr, isAllDay)}</p>
              {event.location && <p className="text-xs text-muted-foreground">Location: {event.location}</p>}
            </div>
            <Button
              variant="outline"
              size="sm"
              className="text-destructive"
              onClick={() => { deleteMutation.mutate(eventId, { onSuccess: onBack }); }}
            >
              <Trash2 className="h-4 w-4" />
            </Button>
          </div>
        </CardHeader>
        <CardContent className="space-y-4">
          {event.description && (
            <div>
              <p className="text-xs font-medium text-muted-foreground mb-1">Description</p>
              <pre className="whitespace-pre-wrap text-sm font-sans">{event.description}</pre>
            </div>
          )}

          {event.attendees && event.attendees.length > 0 && (
            <div>
              <p className="text-xs font-medium text-muted-foreground mb-2">
                Attendees ({event.attendees.length})
              </p>
              <div className="space-y-1">
                {event.attendees.map((a, i) => (
                  <div key={i} className="flex items-center justify-between text-sm">
                    <span>{a.displayName ?? a.email}{a.self ? " (you)" : ""}</span>
                    <Badge variant={
                      a.responseStatus === "accepted" ? "default" :
                      a.responseStatus === "declined" ? "destructive" :
                      "secondary"
                    }>
                      {a.responseStatus}
                    </Badge>
                  </div>
                ))}
              </div>

              <div className="flex gap-2 mt-3">
                {(["accepted", "tentative", "declined"] as const).map((status) => (
                  <Button
                    key={status}
                    variant="outline"
                    size="sm"
                    onClick={() => respondMutation.mutate({ eventId, responseStatus: status })}
                    disabled={respondMutation.isPending}
                  >
                    {status === "accepted" ? "Accept" : status === "tentative" ? "Maybe" : "Decline"}
                  </Button>
                ))}
              </div>
            </div>
          )}

          {event.organizer && (
            <p className="text-xs text-muted-foreground">
              Organized by: {event.organizer.displayName ?? event.organizer.email}
            </p>
          )}
        </CardContent>
      </Card>

      <MeetingPrepCard eventId={eventId} />
    </div>
  );
}

export function CalendarPage() {
  const [searchQuery, setSearchQuery] = useState("");
  const [activeSearch, setActiveSearch] = useState("");
  const [selectedId, setSelectedId] = useState<string | null>(null);

  const { data: upcoming, isLoading } = useCalendarEvents();
  const { data: searchResults } = useCalendarSearch(activeSearch);

  const events = activeSearch ? searchResults?.events : upcoming?.events;

  if (selectedId) {
    return (
      <div className="space-y-4">
        <EventDetail eventId={selectedId} onBack={() => setSelectedId(null)} />
      </div>
    );
  }

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <h1 className="text-2xl font-bold">Calendar</h1>
        <CreateEventDialog />
      </div>

      <div className="flex gap-2">
        <div className="relative flex-1">
          <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
          <Input
            className="pl-9"
            placeholder="Search events..."
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
      ) : !events?.length ? (
        <Card>
          <CardContent className="flex flex-col items-center justify-center py-12 text-muted-foreground">
            <Calendar className="h-10 w-10 mb-3" />
            <p>{activeSearch ? "No events found" : "No upcoming events"}</p>
          </CardContent>
        </Card>
      ) : (
        <div className="space-y-1">
          {events.map((evt) => (
            <button
              key={evt.id}
              onClick={() => setSelectedId(evt.id)}
              className="w-full text-left rounded-md border p-3 hover:bg-accent transition-colors"
            >
              <div className="flex items-center justify-between">
                <span className="text-sm font-medium">{evt.summary}</span>
                <div className="flex items-center gap-2">
                  {evt.isAllDay && <Badge variant="outline" className="text-[10px]">All day</Badge>}
                  {evt.attendeeCount > 0 && (
                    <Badge variant="secondary" className="text-[10px]">{evt.attendeeCount} attendees</Badge>
                  )}
                </div>
              </div>
              <p className="text-xs text-muted-foreground">
                {formatEventTime(evt.start, evt.end, evt.isAllDay)}
              </p>
              {evt.location && (
                <p className="text-xs text-muted-foreground mt-0.5">{evt.location}</p>
              )}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}
