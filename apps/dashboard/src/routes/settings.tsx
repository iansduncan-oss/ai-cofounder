import { useMemo, useState, useEffect } from "react";
import { useHealth, useProviderHealth, useToolTierConfig, useSettings, useProjects, useBudgetStatus } from "@/api/queries";
import { useUpdateToolTier, useUpdateBudgetThresholds, useCreateProject, useDeleteProject } from "@/api/mutations";
import { PageHeader } from "@/components/layout/page-header";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { ListSkeleton } from "@/components/common/loading-skeleton";
import { EmptyState } from "@/components/common/empty-state";
import { formatDate } from "@/lib/utils";
import { usePageTitle } from "@/hooks/use-page-title";
import { AlertTriangle, DollarSign, FolderOpen, Trash2, Plus } from "lucide-react";
import type { AutonomyTier } from "@ai-cofounder/api-client";

const TIER_PRIORITY: Record<string, number> = { red: 0, yellow: 1, green: 2 };

export function SettingsPage() {
  usePageTitle("Settings");
  const { data: health, isLoading: healthLoading, error: healthError } = useHealth();
  const { data: providers, isLoading: providersLoading, error: providersError } = useProviderHealth();
  const { data: tiers, isLoading: tiersLoading, error: tiersError } = useToolTierConfig();
  const updateTier = useUpdateToolTier();

  const sortedTiers = useMemo(() => {
    if (!tiers) return [];
    return [...tiers].sort((a, b) => {
      const tierDiff = (TIER_PRIORITY[a.tier] ?? 2) - (TIER_PRIORITY[b.tier] ?? 2);
      if (tierDiff !== 0) return tierDiff;
      return a.toolName.localeCompare(b.toolName);
    });
  }, [tiers]);

  return (
    <div>
      <PageHeader
        title="Settings"
        description="System health and provider status"
      />

      <div className="space-y-6">
        <Card>
          <CardHeader>
            <CardTitle>System Health</CardTitle>
          </CardHeader>
          <CardContent>
            {healthLoading ? (
              <ListSkeleton rows={1} />
            ) : healthError ? (
              <div className="flex items-center gap-2 text-sm text-destructive">
                <AlertTriangle className="h-4 w-4" />
                <span>Failed to load health data: {healthError.message}</span>
              </div>
            ) : health ? (
              <div className="grid grid-cols-3 gap-4">
                <div>
                  <p className="text-sm text-muted-foreground">Status</p>
                  <Badge
                    variant={health.status === "ok" ? "success" : "warning"}
                  >
                    {health.status}
                  </Badge>
                </div>
                <div>
                  <p className="text-sm text-muted-foreground">Uptime</p>
                  <p className="text-sm font-medium">
                    {Math.floor(health.uptime / 3600)}h{" "}
                    {Math.floor((health.uptime % 3600) / 60)}m
                  </p>
                </div>
                <div>
                  <p className="text-sm text-muted-foreground">Last Check</p>
                  <p className="text-sm font-medium">
                    {formatDate(health.timestamp)}
                  </p>
                </div>
              </div>
            ) : (
              <p className="text-sm text-muted-foreground">
                Unable to reach server
              </p>
            )}
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle>LLM Providers</CardTitle>
          </CardHeader>
          <CardContent>
            {providersLoading ? (
              <ListSkeleton rows={4} />
            ) : providersError ? (
              <div className="flex items-center gap-2 text-sm text-destructive">
                <AlertTriangle className="h-4 w-4" />
                <span>Failed to load providers: {providersError.message}</span>
              </div>
            ) : providers?.providers && providers.providers.length > 0 ? (
              <div className="overflow-x-auto">
                <table className="w-full text-sm">
                  <thead>
                    <tr className="border-b text-left text-muted-foreground">
                      <th className="pb-2 pr-4">Provider</th>
                      <th className="pb-2 pr-4">Status</th>
                      <th className="pb-2 pr-4">Requests</th>
                      <th className="pb-2 pr-4">Success</th>
                      <th className="pb-2 pr-4">Errors</th>
                      <th className="pb-2 pr-4">Avg Latency</th>
                    </tr>
                  </thead>
                  <tbody>
                    {providers.providers.map((p) => (
                      <tr key={p.provider} className="border-b last:border-0">
                        <td className="py-2 pr-4 font-medium">{p.provider}</td>
                        <td className="py-2 pr-4">
                          <Badge
                            variant={p.available ? "success" : "destructive"}
                          >
                            {p.available ? "available" : "unavailable"}
                          </Badge>
                        </td>
                        <td className="py-2 pr-4">{p.totalRequests}</td>
                        <td className="py-2 pr-4">{p.successCount}</td>
                        <td className="py-2 pr-4">{p.errorCount}</td>
                        <td className="py-2 pr-4">{p.avgLatencyMs}ms</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            ) : (
              <p className="text-sm text-muted-foreground">
                No provider data available
              </p>
            )}
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle>Autonomy Tiers</CardTitle>
          </CardHeader>
          <CardContent>
            <p className="mb-4 text-sm text-muted-foreground">
              Configure what the agent can do independently. Green tools execute
              freely, yellow tools require your approval, red tools are blocked
              entirely.
            </p>
            {tiersLoading ? (
              <ListSkeleton rows={5} />
            ) : tiersError ? (
              <div className="flex items-center gap-2 text-sm text-destructive">
                <AlertTriangle className="h-4 w-4" />
                <span>Failed to load tier config: {tiersError.message}</span>
              </div>
            ) : sortedTiers.length > 0 ? (
              <div className="overflow-x-auto">
                <table className="w-full text-sm">
                  <thead>
                    <tr className="border-b text-left text-muted-foreground">
                      <th className="pb-2 pr-4">Tool</th>
                      <th className="pb-2 pr-4">Current Tier</th>
                      <th className="pb-2 pr-4">Change</th>
                    </tr>
                  </thead>
                  <tbody>
                    {sortedTiers.map((t) => (
                      <tr key={t.toolName} className="border-b last:border-0">
                        <td className="py-2 pr-4 font-medium font-mono text-xs">
                          {t.toolName}
                        </td>
                        <td className="py-2 pr-4">
                          <TierBadge tier={t.tier as AutonomyTier} />
                        </td>
                        <td className="py-2 pr-4">
                          <select
                            aria-label={`Autonomy tier for ${t.toolName}`}
                            className="rounded border bg-background px-2 py-1 text-xs"
                            value={t.tier}
                            onChange={(e) =>
                              updateTier.mutate({
                                toolName: t.toolName,
                                tier: e.target.value as AutonomyTier,
                              })
                            }
                          >
                            <option value="green">green</option>
                            <option value="yellow">yellow</option>
                            <option value="red">red</option>
                          </select>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            ) : (
              <p className="text-sm text-muted-foreground">
                No tools configured. Start the agent server to seed default tool
                tiers.
              </p>
            )}
          </CardContent>
        </Card>

        <BudgetThresholdsCard />
        <ProjectRegistrationCard />
      </div>
    </div>
  );
}

function BudgetThresholdsCard() {
  const { data: settings } = useSettings();
  const { data: budgetStatus } = useBudgetStatus();
  const updateBudget = useUpdateBudgetThresholds();

  const [dailyUsd, setDailyUsd] = useState<number>(0);
  const [weeklyUsd, setWeeklyUsd] = useState<number>(0);

  useEffect(() => {
    if (settings) {
      setDailyUsd(settings.dailyBudgetUsd ?? 0);
      setWeeklyUsd(settings.weeklyBudgetUsd ?? 0);
    }
  }, [settings]);

  const dailyPercent = budgetStatus?.daily?.percentUsed ?? 0;

  return (
    <Card>
      <CardHeader>
        <div className="flex items-center gap-2">
          <DollarSign className="h-5 w-5 text-muted-foreground" />
          <CardTitle>Budget Thresholds</CardTitle>
        </div>
        <CardDescription>
          Set daily and weekly spending limits. Alerts fire when thresholds are breached.
        </CardDescription>
      </CardHeader>
      <CardContent>
        <div className="space-y-4">
          <div className="flex flex-wrap items-end gap-4">
            <div className="flex flex-col gap-1">
              <label htmlFor="daily-budget" className="text-sm font-medium">
                Daily Budget (USD)
              </label>
              <input
                id="daily-budget"
                type="number"
                min={0}
                step={0.01}
                value={dailyUsd}
                onChange={(e) => setDailyUsd(parseFloat(e.target.value) || 0)}
                className="rounded border bg-background px-3 py-2 text-sm w-32"
              />
            </div>
            <div className="flex flex-col gap-1">
              <label htmlFor="weekly-budget" className="text-sm font-medium">
                Weekly Budget (USD)
              </label>
              <input
                id="weekly-budget"
                type="number"
                min={0}
                step={0.01}
                value={weeklyUsd}
                onChange={(e) => setWeeklyUsd(parseFloat(e.target.value) || 0)}
                className="rounded border bg-background px-3 py-2 text-sm w-32"
              />
            </div>
            <button
              type="button"
              onClick={() => updateBudget.mutate({ dailyUsd, weeklyUsd })}
              disabled={updateBudget.isPending}
              className="rounded bg-primary px-4 py-2 text-sm font-medium text-primary-foreground hover:bg-primary/90 disabled:opacity-50"
              aria-label="Save budget thresholds"
            >
              Save Budget
            </button>
          </div>

          {dailyUsd > 0 && (
            <div className="flex items-center gap-2">
              <span className="text-xs text-muted-foreground">Daily usage:</span>
              <div className="h-2 w-32 overflow-hidden rounded-full bg-muted">
                <div
                  className="h-full rounded-full bg-primary transition-all"
                  style={{ width: `${Math.min(dailyPercent, 100)}%` }}
                />
              </div>
              <span className="text-xs text-muted-foreground">{dailyPercent.toFixed(0)}%</span>
            </div>
          )}
        </div>
      </CardContent>
    </Card>
  );
}

function ProjectRegistrationCard() {
  const { data: projects, isLoading } = useProjects();
  const createProject = useCreateProject();
  const deleteProject = useDeleteProject();

  const [showForm, setShowForm] = useState(false);
  const [name, setName] = useState("");
  const [repoUrl, setRepoUrl] = useState("");
  const [workspacePath, setWorkspacePath] = useState("");
  const [description, setDescription] = useState("");

  function resetForm() {
    setName("");
    setRepoUrl("");
    setWorkspacePath("");
    setDescription("");
    setShowForm(false);
  }

  function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    createProject.mutate(
      { name, repoUrl, workspacePath, description: description || undefined },
      { onSuccess: resetForm }
    );
  }

  function handleDelete(id: string) {
    if (window.confirm("Remove this project from the registry?")) {
      deleteProject.mutate(id);
    }
  }

  return (
    <Card>
      <CardHeader>
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2">
            <FolderOpen className="h-5 w-5 text-muted-foreground" />
            <CardTitle>Project Registration</CardTitle>
          </div>
          <button
            type="button"
            onClick={() => setShowForm((v) => !v)}
            className="flex items-center gap-1 rounded border px-3 py-1.5 text-sm font-medium hover:bg-muted"
          >
            <Plus className="h-4 w-4" />
            Register New Project
          </button>
        </div>
        <CardDescription>
          Manage registered projects for multi-project orchestration.
        </CardDescription>
      </CardHeader>
      <CardContent>
        {isLoading ? (
          <ListSkeleton rows={3} />
        ) : projects && projects.length > 0 ? (
          <div className="space-y-2">
            {projects.map((project) => (
              <div
                key={project.id}
                className="flex items-center justify-between rounded border p-3"
              >
                <div className="flex flex-col gap-0.5">
                  <span className="text-sm font-medium">{project.name}</span>
                  <span className="text-xs text-muted-foreground">{project.repoUrl}</span>
                  <span className="text-xs text-muted-foreground">{project.workspacePath}</span>
                </div>
                <button
                  type="button"
                  onClick={() => handleDelete(project.id)}
                  aria-label="Delete project"
                  className="rounded p-1.5 text-muted-foreground hover:bg-muted hover:text-destructive"
                >
                  <Trash2 className="h-4 w-4" />
                </button>
              </div>
            ))}
          </div>
        ) : (
          <EmptyState
            icon={<FolderOpen className="h-8 w-8" />}
            title="No projects registered"
            description="Register a project to enable multi-project orchestration."
          />
        )}

        {showForm && (
          <form onSubmit={handleSubmit} className="mt-4 space-y-3 rounded border p-4">
            <h3 className="text-sm font-semibold">Register New Project</h3>
            <div className="flex flex-col gap-1">
              <label htmlFor="project-name" className="text-xs font-medium text-muted-foreground">
                Name *
              </label>
              <input
                id="project-name"
                type="text"
                required
                value={name}
                onChange={(e) => setName(e.target.value)}
                placeholder="Project name"
                className="rounded border bg-background px-3 py-2 text-sm"
              />
            </div>
            <div className="flex flex-col gap-1">
              <label htmlFor="project-repo" className="text-xs font-medium text-muted-foreground">
                Repository URL *
              </label>
              <input
                id="project-repo"
                type="text"
                required
                value={repoUrl}
                onChange={(e) => setRepoUrl(e.target.value)}
                placeholder="Repository URL"
                className="rounded border bg-background px-3 py-2 text-sm"
              />
            </div>
            <div className="flex flex-col gap-1">
              <label htmlFor="project-path" className="text-xs font-medium text-muted-foreground">
                Workspace Path *
              </label>
              <input
                id="project-path"
                type="text"
                required
                value={workspacePath}
                onChange={(e) => setWorkspacePath(e.target.value)}
                placeholder="Workspace path"
                className="rounded border bg-background px-3 py-2 text-sm"
              />
            </div>
            <div className="flex flex-col gap-1">
              <label htmlFor="project-desc" className="text-xs font-medium text-muted-foreground">
                Description
              </label>
              <input
                id="project-desc"
                type="text"
                value={description}
                onChange={(e) => setDescription(e.target.value)}
                placeholder="Description (optional)"
                className="rounded border bg-background px-3 py-2 text-sm"
              />
            </div>
            <div className="flex gap-2">
              <button
                type="submit"
                disabled={createProject.isPending}
                className="rounded bg-primary px-4 py-2 text-sm font-medium text-primary-foreground hover:bg-primary/90 disabled:opacity-50"
              >
                Register
              </button>
              <button
                type="button"
                onClick={resetForm}
                className="rounded border px-4 py-2 text-sm font-medium hover:bg-muted"
              >
                Cancel
              </button>
            </div>
          </form>
        )}
      </CardContent>
    </Card>
  );
}

function TierBadge({ tier }: { tier: AutonomyTier }) {
  const variant =
    tier === "green"
      ? "success"
      : tier === "yellow"
        ? "warning"
        : "destructive";
  return <Badge variant={variant}>{tier}</Badge>;
}
