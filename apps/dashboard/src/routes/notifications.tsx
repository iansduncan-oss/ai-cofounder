import { useState } from "react";
import { Link } from "react-router";
import { Bell, ShieldCheck, AlertTriangle, DollarSign } from "lucide-react";
import { usePendingApprovals, useMonitoringStatus, useBudgetStatus } from "@/api/queries";
import { PageHeader } from "@/components/layout/page-header";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { EmptyState } from "@/components/common/empty-state";
import { RelativeTime } from "@/components/common/relative-time";
import { usePageTitle } from "@/hooks/use-page-title";
import { cn } from "@/lib/utils";

interface NotificationItem {
  id: string;
  title: string;
  description?: string;
  type: "approval" | "alert" | "budget" | "task";
  severity: "info" | "warning" | "critical";
  timestamp: string;
  linkTo?: string;
}

type FilterTab = "all" | "approval" | "alert" | "budget";

const tabs: { key: FilterTab; label: string }[] = [
  { key: "all", label: "All" },
  { key: "approval", label: "Approvals" },
  { key: "alert", label: "Alerts" },
  { key: "budget", label: "Budget" },
];

function severityVariant(severity: NotificationItem["severity"]) {
  if (severity === "critical") return "destructive";
  if (severity === "warning") return "warning";
  return "secondary";
}

function NotificationIcon({ type }: { type: NotificationItem["type"] }) {
  if (type === "approval") return <ShieldCheck className="h-4 w-4 text-amber-500" />;
  if (type === "alert") return <AlertTriangle className="h-4 w-4 text-red-500" />;
  if (type === "budget") return <DollarSign className="h-4 w-4 text-orange-500" />;
  return <Bell className="h-4 w-4 text-blue-500" />;
}

export function NotificationsPage() {
  usePageTitle("Notifications");

  const [activeTab, setActiveTab] = useState<FilterTab>("all");

  const { data: approvals } = usePendingApprovals();
  const { data: monitoring } = useMonitoringStatus();
  const { data: budgetStatus } = useBudgetStatus();

  const notifications: NotificationItem[] = [];

  // Aggregate from approvals
  approvals?.forEach((approval) => {
    notifications.push({
      id: `approval-${approval.id}`,
      title: `Approval: ${approval.reason}`,
      description: `Requested by ${approval.requestedBy}`,
      type: "approval",
      severity: "warning",
      timestamp: approval.createdAt,
      linkTo: "/dashboard/approvals",
    });
  });

  // Aggregate from monitoring alerts
  const alerts = Array.isArray(monitoring?.alerts) ? monitoring.alerts : [];
  alerts.forEach((alert: { id?: string; message: string; level?: string; timestamp?: string }) => {
    const severity: NotificationItem["severity"] =
      alert.level === "critical" ? "critical" : "warning";
    notifications.push({
      id: `alert-${alert.id ?? alert.message}`,
      title: `Alert: ${alert.message}`,
      type: "alert",
      severity,
      timestamp: alert.timestamp ?? new Date().toISOString(),
      linkTo: "/dashboard/hud",
    });
  });

  // Add budget warning if daily percentUsed > 90
  const dailyPercent = budgetStatus?.daily?.percentUsed ?? 0;
  if (budgetStatus && dailyPercent !== null && dailyPercent > 90) {
    const severity: NotificationItem["severity"] =
      dailyPercent > 100 ? "critical" : "warning";
    notifications.push({
      id: "budget-warning",
      title: `Budget: ${dailyPercent}% of daily limit used`,
      description: `$${budgetStatus.daily.spentUsd.toFixed(2)} of $${budgetStatus.daily.limitUsd.toFixed(2)} daily limit`,
      type: "budget",
      severity,
      timestamp: new Date().toISOString(),
      linkTo: "/dashboard/usage",
    });
  }

  // Sort by most recent first
  notifications.sort(
    (a, b) => new Date(b.timestamp).getTime() - new Date(a.timestamp).getTime(),
  );

  // Apply tab filter
  const filtered =
    activeTab === "all"
      ? notifications
      : notifications.filter((n) => n.type === activeTab);

  return (
    <div>
      <PageHeader
        title="Notifications"
        description="All system notifications in one place"
      />

      {/* Filter tabs */}
      <div className="mb-4 flex gap-2 flex-wrap">
        {tabs.map(({ key, label }) => (
          <button
            key={key}
            onClick={() => setActiveTab(key)}
            className={cn(
              "rounded-full px-3 py-1 text-xs font-medium transition-colors",
              activeTab === key
                ? "bg-primary text-primary-foreground"
                : "bg-muted text-muted-foreground hover:bg-accent hover:text-accent-foreground",
            )}
          >
            {label}
          </button>
        ))}
      </div>

      {filtered.length === 0 ? (
        <EmptyState
          icon={<Bell className="h-10 w-10" />}
          title="No notifications"
          description="System notifications will appear here"
        />
      ) : (
        <div className="space-y-3">
          {filtered.map((notification) => (
            <Card key={notification.id}>
              <CardContent className="p-4">
                <div className="flex items-start gap-3">
                  <div className="mt-0.5 shrink-0">
                    <NotificationIcon type={notification.type} />
                  </div>
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2 flex-wrap">
                      <p className="text-sm font-medium">{notification.title}</p>
                      <Badge variant={severityVariant(notification.severity)}>
                        {notification.severity}
                      </Badge>
                    </div>
                    {notification.description && (
                      <p className="mt-0.5 text-xs text-muted-foreground">
                        {notification.description}
                      </p>
                    )}
                    <div className="mt-1 flex items-center gap-2">
                      <span className="text-xs text-muted-foreground">
                        <RelativeTime date={notification.timestamp} />
                      </span>
                      {notification.linkTo && (
                        <Link
                          to={notification.linkTo}
                          className="text-xs text-primary hover:underline"
                        >
                          View
                        </Link>
                      )}
                    </div>
                  </div>
                </div>
              </CardContent>
            </Card>
          ))}
        </div>
      )}
    </div>
  );
}
