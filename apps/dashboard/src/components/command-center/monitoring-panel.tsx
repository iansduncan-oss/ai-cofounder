import { useState, useRef, useCallback, useEffect } from "react";
import {
  useHealth,
  useProviderHealth,
  useMonitoringStatus,
  useQueueStatus,
  useBriefing,
  useToolStats,
  useErrorSummary,
} from "@/api/queries";
import { apiClient } from "@/api/client";
import { MetricCard } from "@/components/ui/metric-card";
import { Badge } from "@/components/ui/badge";
import { useCommandCenter } from "@/providers/command-center-provider";
import { cn } from "@/lib/utils";
import {
  Activity,
  AlertTriangle,
  Cpu,
  Layers,
  CheckCircle,
  XCircle,
  CircleDot,
  GitPullRequest,
  Volume2,
  Loader2,
  Square,
  FileText,
  Search,
} from "lucide-react";

type DetailTab = "alerts" | "github" | "vps" | "queues" | "providers";

function StatusDot({ status }: { status: "ok" | "warning" | "critical" | "unknown" }) {
  return (
    <div
      className={cn(
        "h-2 w-2 rounded-full",
        status === "ok" && "bg-emerald-500",
        status === "warning" && "bg-amber-500",
        status === "critical" && "bg-red-500",
        status === "unknown" && "bg-gray-400",
      )}
    />
  );
}

function BriefingSection({ text }: { text: string }) {
  const [audioState, setAudioState] = useState<"idle" | "loading" | "playing">("idle");
  const audioRef = useRef<HTMLAudioElement | null>(null);
  const blobUrlRef = useRef<string | null>(null);

  const cleanup = useCallback(() => {
    if (audioRef.current) {
      audioRef.current.pause();
      audioRef.current = null;
    }
    if (blobUrlRef.current) {
      URL.revokeObjectURL(blobUrlRef.current);
      blobUrlRef.current = null;
    }
  }, []);

  useEffect(() => cleanup, [cleanup]);

  const handlePlay = useCallback(async () => {
    setAudioState("loading");
    try {
      const blob = await apiClient.getBriefingAudio();
      const url = URL.createObjectURL(blob);
      blobUrlRef.current = url;
      const audio = new Audio(url);
      audio.onended = () => {
        setAudioState("idle");
        cleanup();
      };
      audioRef.current = audio;
      await audio.play();
      setAudioState("playing");
    } catch {
      setAudioState("idle");
      cleanup();
    }
  }, [cleanup]);

  const handleStop = useCallback(() => {
    cleanup();
    setAudioState("idle");
  }, [cleanup]);

  return (
    <div className="border-t px-3 py-2">
      <div className="flex items-center justify-between mb-1">
        <span className="flex items-center gap-1.5 text-[10px] uppercase tracking-wider text-muted-foreground">
          <FileText className="h-3 w-3" /> Briefing
        </span>
        {audioState === "idle" && (
          <button
            onClick={handlePlay}
            className="flex items-center gap-1 text-[10px] text-muted-foreground hover:text-foreground"
          >
            <Volume2 className="h-3 w-3" /> Play
          </button>
        )}
        {audioState === "loading" && (
          <span className="flex items-center gap-1 text-[10px] text-muted-foreground">
            <Loader2 className="h-3 w-3 animate-spin" /> Loading
          </span>
        )}
        {audioState === "playing" && (
          <button
            onClick={handleStop}
            className="flex items-center gap-1 text-[10px] text-muted-foreground hover:text-foreground"
          >
            <Square className="h-3 w-3" /> Stop
          </button>
        )}
      </div>
      <p className="text-xs text-muted-foreground line-clamp-4 whitespace-pre-wrap">{text}</p>
    </div>
  );
}

export function MonitoringPanel() {
  const [activeTab, setActiveTab] = useState<DetailTab>("alerts");
  const { investigateAlert } = useCommandCenter();

  const { data: health } = useHealth();
  const { data: providers } = useProviderHealth();
  const { data: monitoring } = useMonitoringStatus();
  const { data: queues } = useQueueStatus();
  const { data: briefing } = useBriefing();
  const { data: toolStats } = useToolStats();
  const { data: errorSummary } = useErrorSummary();

  const allProvidersHealthy = providers?.providers.every((p) => p.available) ?? false;
  const alertCount = monitoring?.alerts?.length ?? 0;
  const criticalAlerts = monitoring?.alerts?.filter((a) => a.severity === "critical").length ?? 0;
  const queueDepth = queues?.queues?.reduce((sum, q) => sum + q.waiting + q.active, 0) ?? 0;

  const tabs: { id: DetailTab; label: string }[] = [
    { id: "alerts", label: `Alerts${alertCount > 0 ? ` (${alertCount})` : ""}` },
    { id: "github", label: "GitHub" },
    { id: "vps", label: "VPS" },
    { id: "queues", label: "Queues" },
    { id: "providers", label: "LLM" },
  ];

  return (
    <div className="flex flex-col h-full">
      {/* Micro metrics row */}
      <div className="grid grid-cols-2 gap-1.5 p-2 shrink-0">
        <MetricCard
          label="System"
          value={health?.status === "ok" ? "OK" : "--"}
          icon={<Activity className="h-3.5 w-3.5" />}
          status={health?.status === "ok" ? "ok" : "warning"}
        />
        <MetricCard
          label="LLM"
          value={allProvidersHealthy ? "OK" : "Deg."}
          icon={<Cpu className="h-3.5 w-3.5" />}
          status={allProvidersHealthy ? "ok" : "warning"}
        />
        <MetricCard
          label="Alerts"
          value={alertCount}
          icon={<AlertTriangle className="h-3.5 w-3.5" />}
          status={criticalAlerts > 0 ? "critical" : alertCount > 0 ? "warning" : "ok"}
        />
        <MetricCard
          label="Queue"
          value={queueDepth}
          icon={<Layers className="h-3.5 w-3.5" />}
          status="ok"
        />
      </div>

      {/* Tab bar */}
      <div className="flex gap-0.5 px-2 shrink-0">
        {tabs.map((t) => (
          <button
            key={t.id}
            onClick={() => setActiveTab(t.id)}
            className={cn(
              "px-2 py-1 rounded-t text-[10px] font-medium transition-colors",
              activeTab === t.id
                ? "bg-surface-2 text-foreground"
                : "text-muted-foreground hover:text-foreground",
            )}
          >
            {t.label}
          </button>
        ))}
      </div>

      {/* Tab content */}
      <div className="flex-1 overflow-y-auto border-t px-3 py-2 min-h-0">
        {activeTab === "alerts" && (
          <div className="space-y-1.5">
            {monitoring?.alerts && monitoring.alerts.length > 0 ? (
              monitoring.alerts.map((alert, i) => (
                <div key={i} className="flex items-start gap-2 rounded-md border p-2 text-xs">
                  <Badge
                    variant={
                      alert.severity === "critical"
                        ? "destructive"
                        : alert.severity === "warning"
                          ? "warning"
                          : "secondary"
                    }
                    className="shrink-0 text-[9px]"
                  >
                    {alert.severity}
                  </Badge>
                  <div className="flex-1 min-w-0">
                    <p className="text-[10px] text-muted-foreground">{alert.source}</p>
                    <p className="text-xs">{alert.message}</p>
                  </div>
                  <button
                    onClick={() => investigateAlert(alert.message)}
                    className="shrink-0 text-[10px] text-muted-foreground hover:text-foreground"
                    title="Investigate in chat"
                  >
                    <Search className="h-3 w-3" />
                  </button>
                </div>
              ))
            ) : (
              <p className="text-xs text-muted-foreground py-4 text-center">No active alerts</p>
            )}
            {/* Errors summary */}
            {(errorSummary?.totalErrors ?? 0) > 0 && (
              <div className="mt-2 rounded-md border border-destructive/30 p-2">
                <p className="text-[10px] text-destructive font-medium">
                  {errorSummary?.totalErrors} errors in 24h
                </p>
                {errorSummary?.errors?.slice(0, 3).map((e, i) => (
                  <p key={i} className="text-[10px] text-muted-foreground">
                    {e.toolName}: {e.count}x
                  </p>
                ))}
              </div>
            )}
          </div>
        )}

        {activeTab === "github" && (
          <div className="space-y-3">
            {monitoring?.github ? (
              <>
                <div>
                  <p className="text-[10px] uppercase tracking-wider text-muted-foreground mb-1.5">
                    CI
                  </p>
                  {monitoring.github.ciStatus.length > 0 ? (
                    <div className="space-y-1">
                      {monitoring.github.ciStatus.map((ci, i) => (
                        <div key={i} className="flex items-center justify-between text-xs">
                          <span className="truncate">
                            {ci.repo.split("/").pop()} / {ci.branch}
                          </span>
                          {ci.status === "success" ? (
                            <CheckCircle className="h-3 w-3 text-emerald-500 shrink-0" />
                          ) : ci.status === "failure" ? (
                            <XCircle className="h-3 w-3 text-red-500 shrink-0" />
                          ) : (
                            <CircleDot className="h-3 w-3 text-amber-500 shrink-0" />
                          )}
                        </div>
                      ))}
                    </div>
                  ) : (
                    <p className="text-[10px] text-muted-foreground">No CI data</p>
                  )}
                </div>
                <div>
                  <p className="text-[10px] uppercase tracking-wider text-muted-foreground mb-1.5">
                    Open PRs
                  </p>
                  {monitoring.github.openPRs.length > 0 ? (
                    <div className="space-y-1">
                      {monitoring.github.openPRs.slice(0, 5).map((pr, i) => (
                        <div key={i} className="flex items-center gap-1.5 text-xs">
                          <GitPullRequest className="h-3 w-3 shrink-0 text-muted-foreground" />
                          <span className="truncate">
                            #{pr.number} {pr.title}
                          </span>
                        </div>
                      ))}
                    </div>
                  ) : (
                    <p className="text-[10px] text-muted-foreground">No open PRs</p>
                  )}
                </div>
              </>
            ) : (
              <p className="text-xs text-muted-foreground">Not configured</p>
            )}
          </div>
        )}

        {activeTab === "vps" && (
          <div className="space-y-3">
            {monitoring?.vps ? (
              <>
                <div className="grid grid-cols-2 gap-2">
                  <div className="text-xs">
                    <p className="text-[10px] text-muted-foreground">Disk</p>
                    <p className="font-metric font-bold">{monitoring.vps.diskUsagePercent}%</p>
                  </div>
                  <div className="text-xs">
                    <p className="text-[10px] text-muted-foreground">Memory</p>
                    <p className="font-metric font-bold">{monitoring.vps.memoryUsagePercent}%</p>
                  </div>
                  <div className="text-xs">
                    <p className="text-[10px] text-muted-foreground">Load</p>
                    <p className="font-metric font-bold">
                      {monitoring.vps.cpuLoadAvg.map((l) => l.toFixed(1)).join(" / ")}
                    </p>
                  </div>
                  <div className="text-xs">
                    <p className="text-[10px] text-muted-foreground">Uptime</p>
                    <p className="font-metric">{monitoring.vps.uptime}</p>
                  </div>
                </div>
                {monitoring.vps.containers && monitoring.vps.containers.length > 0 && (
                  <div>
                    <p className="text-[10px] uppercase tracking-wider text-muted-foreground mb-1.5">
                      Containers
                    </p>
                    <div className="space-y-1">
                      {monitoring.vps.containers.map((c, i) => (
                        <div key={i} className="flex items-center justify-between text-xs">
                          <span className="truncate">{c.name}</span>
                          <Badge
                            variant={c.status.includes("Up") ? "success" : "destructive"}
                            className="text-[9px]"
                          >
                            {c.health ?? c.status.split(" ")[0]}
                          </Badge>
                        </div>
                      ))}
                    </div>
                  </div>
                )}
              </>
            ) : (
              <p className="text-xs text-muted-foreground">Not monitored</p>
            )}
          </div>
        )}

        {activeTab === "queues" && (
          <div className="space-y-1.5">
            {queues?.queues && queues.queues.length > 0 ? (
              queues.queues.map((q, i) => (
                <div key={i} className="flex items-center justify-between text-xs">
                  <span className="font-medium">{q.name}</span>
                  <div className="flex gap-1.5 text-muted-foreground text-[10px]">
                    <span>{q.waiting}w</span>
                    <span>{q.active}a</span>
                    <span className="text-emerald-600">{q.completed}c</span>
                    {q.failed > 0 && <span className="text-red-500">{q.failed}f</span>}
                  </div>
                </div>
              ))
            ) : (
              <p className="text-xs text-muted-foreground">Queue system not active</p>
            )}
          </div>
        )}

        {activeTab === "providers" && (
          <div className="space-y-3">
            {providers?.providers && providers.providers.length > 0 ? (
              <div className="space-y-1.5">
                {providers.providers.map((p, i) => (
                  <div key={i} className="flex items-center justify-between text-xs">
                    <div className="flex items-center gap-1.5">
                      <StatusDot status={p.available ? "ok" : "critical"} />
                      <span className="font-medium">{p.provider}</span>
                    </div>
                    <div className="flex gap-2 text-[10px] text-muted-foreground">
                      <span>{Math.round(p.avgLatencyMs)}ms</span>
                      <span>
                        {p.successCount}/{p.totalRequests}
                      </span>
                    </div>
                  </div>
                ))}
              </div>
            ) : (
              <p className="text-xs text-muted-foreground">No providers</p>
            )}
            {/* Tool stats */}
            {toolStats?.tools && toolStats.tools.length > 0 && (
              <div>
                <p className="text-[10px] uppercase tracking-wider text-muted-foreground mb-1.5">
                  Top Tools
                </p>
                <div className="space-y-1">
                  {toolStats.tools.slice(0, 6).map((t, i) => (
                    <div key={i} className="flex items-center justify-between text-xs">
                      <span className="truncate">{t.toolName}</span>
                      <span className="text-[10px] text-muted-foreground">
                        {Math.round(t.avgDurationMs)}ms · {t.totalExecutions}x
                      </span>
                    </div>
                  ))}
                </div>
              </div>
            )}
          </div>
        )}
      </div>

      {/* Briefing */}
      {briefing?.briefing && <BriefingSection text={briefing.briefing} />}
    </div>
  );
}
