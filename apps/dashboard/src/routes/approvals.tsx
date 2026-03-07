import { useState } from "react";
import { usePendingApprovals } from "@/api/queries";
import { useResolveApproval } from "@/api/mutations";
import { PageHeader } from "@/components/layout/page-header";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogHeader,
  DialogTitle,
  DialogDescription,
  DialogFooter,
} from "@/components/ui/dialog";
import { Textarea } from "@/components/ui/textarea";
import { ApprovalStatusBadge } from "@/components/common/status-badge";
import { ListSkeleton } from "@/components/common/loading-skeleton";
import { EmptyState } from "@/components/common/empty-state";
import { RelativeTime } from "@/components/common/relative-time";
import { usePageTitle } from "@/hooks/use-page-title";
import { ShieldCheck, CheckCircle, XCircle, AlertTriangle } from "lucide-react";
import type { Approval } from "@ai-cofounder/api-client";

export function ApprovalsPage() {
  usePageTitle("Approvals");

  const { data: approvals, isLoading, error } = usePendingApprovals();
  const resolveApproval = useResolveApproval();

  const [dialogOpen, setDialogOpen] = useState(false);
  const [selectedApproval, setSelectedApproval] = useState<Approval | null>(null);
  const [action, setAction] = useState<"approved" | "rejected">("approved");
  const [decision, setDecision] = useState("");

  const openDialog = (approval: Approval, newAction: "approved" | "rejected") => {
    setSelectedApproval(approval);
    setAction(newAction);
    setDecision("");
    setDialogOpen(true);
  };

  const handleConfirm = () => {
    if (!selectedApproval) return;
    resolveApproval.mutate(
      {
        id: selectedApproval.id,
        status: action,
        decision: decision || (action === "approved" ? "Approved via dashboard" : "Rejected via dashboard"),
        decidedBy: "dashboard-user",
      },
      {
        onSuccess: () => {
          setDialogOpen(false);
          setSelectedApproval(null);
        },
      },
    );
  };

  return (
    <div>
      <PageHeader
        title="Approvals"
        description="Review and manage pending approval requests"
      />

      {error ? (
        <div className="flex flex-col items-center justify-center py-12 text-center">
          <AlertTriangle className="mb-3 h-8 w-8 text-destructive" />
          <p className="text-sm font-medium">Failed to load approvals</p>
          <p className="mt-1 text-xs text-muted-foreground">{error.message}</p>
        </div>
      ) : isLoading ? (
        <ListSkeleton rows={3} />
      ) : approvals && approvals.length > 0 ? (
        <div className="space-y-3">
          {approvals.map((approval) => (
            <Card key={approval.id}>
              <CardContent className="flex items-start justify-between p-4">
                <div className="flex-1">
                  <div className="flex items-center gap-2">
                    <h3 className="text-sm font-medium">
                      Approval Request
                    </h3>
                    <ApprovalStatusBadge status={approval.status} />
                  </div>
                  <p className="mt-1 text-sm text-muted-foreground">
                    {approval.reason}
                  </p>
                  <p className="mt-2 text-xs text-muted-foreground">
                    Requested by {approval.requestedBy} ·{" "}
                    <RelativeTime date={approval.createdAt} />
                  </p>
                  {approval.decision && (
                    <p className="mt-1 text-xs text-muted-foreground">
                      Decision: {approval.decision}
                    </p>
                  )}
                </div>
                {approval.status === "pending" && (
                  <div className="ml-4 flex gap-2">
                    <Button
                      size="sm"
                      variant="outline"
                      onClick={() => openDialog(approval, "approved")}
                      aria-label="Approve request"
                    >
                      <CheckCircle className="mr-1 h-3 w-3" />
                      Approve
                    </Button>
                    <Button
                      size="sm"
                      variant="destructive"
                      onClick={() => openDialog(approval, "rejected")}
                      aria-label="Reject request"
                    >
                      <XCircle className="mr-1 h-3 w-3" />
                      Reject
                    </Button>
                  </div>
                )}
              </CardContent>
            </Card>
          ))}
        </div>
      ) : (
        <EmptyState
          icon={<ShieldCheck className="h-10 w-10" />}
          title="No pending approvals"
          description="Approval requests from agents will appear here"
        />
      )}

      <Dialog open={dialogOpen} onClose={() => setDialogOpen(false)}>
        <DialogHeader>
          <DialogTitle>
            {action === "approved" ? "Approve" : "Reject"} Request
          </DialogTitle>
          <DialogDescription>
            {selectedApproval?.reason}
          </DialogDescription>
        </DialogHeader>
        <Textarea
          placeholder="Add a note (optional)..."
          value={decision}
          onChange={(e) => setDecision(e.target.value)}
          rows={3}
        />
        <DialogFooter>
          <Button variant="outline" onClick={() => setDialogOpen(false)}>
            Cancel
          </Button>
          <Button
            variant={action === "approved" ? "default" : "destructive"}
            onClick={handleConfirm}
            disabled={resolveApproval.isPending}
          >
            {resolveApproval.isPending
              ? "Submitting..."
              : action === "approved"
                ? "Confirm Approve"
                : "Confirm Reject"}
          </Button>
        </DialogFooter>
      </Dialog>
    </div>
  );
}
