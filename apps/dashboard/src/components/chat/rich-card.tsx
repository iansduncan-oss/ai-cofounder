import { Mail, Calendar, Target, DollarSign, Rocket } from "lucide-react";

export interface RichCardData {
  type: "email_preview" | "calendar_day" | "goal_progress" | "cost_summary" | "deploy_status";
  data: Record<string, unknown>;
}

const CARD_ICONS: Record<string, typeof Mail> = {
  email_preview: Mail,
  calendar_day: Calendar,
  goal_progress: Target,
  cost_summary: DollarSign,
  deploy_status: Rocket,
};

export function RichCard({ type, data }: RichCardData) {
  const Icon = CARD_ICONS[type] ?? Target;

  return (
    <div className="my-2 rounded-lg border border-border/50 bg-muted/30 p-3">
      <div className="flex items-center gap-2 mb-2 text-xs font-medium text-muted-foreground uppercase tracking-wide">
        <Icon className="h-3.5 w-3.5 text-purple-400" />
        {type.replace(/_/g, " ")}
      </div>
      <div className="text-sm space-y-1">
        {type === "email_preview" && <EmailPreview data={data} />}
        {type === "calendar_day" && <CalendarDay data={data} />}
        {type === "goal_progress" && <GoalProgress data={data} />}
        {type === "cost_summary" && <CostSummary data={data} />}
        {type === "deploy_status" && <DeployStatus data={data} />}
      </div>
    </div>
  );
}

function EmailPreview({ data }: { data: Record<string, unknown> }) {
  const emails = (data.emails ?? []) as Array<{ from: string; subject: string; snippet?: string }>;
  return (
    <div className="space-y-1.5">
      {emails.map((e, i) => (
        <div key={i} className="flex flex-col">
          <span className="font-medium text-foreground">{e.subject}</span>
          <span className="text-xs text-muted-foreground">from {e.from}{e.snippet ? ` — ${e.snippet}` : ""}</span>
        </div>
      ))}
    </div>
  );
}

function CalendarDay({ data }: { data: Record<string, unknown> }) {
  const events = (data.events ?? []) as Array<{ summary: string; start: string; end: string }>;
  return (
    <div className="space-y-1">
      {events.map((e, i) => (
        <div key={i} className="flex justify-between">
          <span className="text-foreground">{e.summary}</span>
          <span className="text-xs text-muted-foreground">{e.start} – {e.end}</span>
        </div>
      ))}
      {events.length === 0 && <span className="text-muted-foreground">No events today</span>}
    </div>
  );
}

function GoalProgress({ data }: { data: Record<string, unknown> }) {
  const goals = (data.goals ?? []) as Array<{ title: string; progress: string; status: string }>;
  return (
    <div className="space-y-1">
      {goals.map((g, i) => (
        <div key={i} className="flex justify-between">
          <span className="text-foreground">{g.title}</span>
          <span className="text-xs text-muted-foreground">{g.progress} · {g.status}</span>
        </div>
      ))}
    </div>
  );
}

function CostSummary({ data }: { data: Record<string, unknown> }) {
  return (
    <div className="flex gap-6">
      <div>
        <div className="text-lg font-semibold text-foreground">${String(data.totalCostUsd ?? "0")}</div>
        <div className="text-xs text-muted-foreground">{String(data.period ?? "this week")}</div>
      </div>
      <div>
        <div className="text-lg font-semibold text-foreground">{String(data.requestCount ?? "0")}</div>
        <div className="text-xs text-muted-foreground">requests</div>
      </div>
    </div>
  );
}

function DeployStatus({ data }: { data: Record<string, unknown> }) {
  const status = String(data.status ?? "unknown");
  const color = status === "success" ? "text-green-400" : status === "failed" ? "text-red-400" : "text-yellow-400";
  return (
    <div className="flex items-center gap-2">
      <span className={`font-medium ${color}`}>{status}</span>
      {data.environment ? <span className="text-xs text-muted-foreground">({String(data.environment)})</span> : null}
      {data.duration ? <span className="text-xs text-muted-foreground">{String(data.duration)}</span> : null}
    </div>
  );
}
