import { useParams, Link } from "react-router";
import { usePipeline } from "@/api/queries";
import { PageHeader } from "@/components/layout/page-header";
import { usePageTitle } from "@/hooks/use-page-title";
import { ListSkeleton } from "@/components/common/loading-skeleton";
import { Card, CardContent } from "@/components/ui/card";
import { PipelineStateBadge } from "@/routes/pipelines";
import { AlertTriangle, ArrowLeft } from "lucide-react";
import { Button } from "@/components/ui/button";

export function PipelineDetailPage() {
  const { jobId } = useParams<{ jobId: string }>();
  usePageTitle("Pipeline Detail");

  const { data, isLoading, error } = usePipeline(jobId ?? null);

  const shortId = jobId?.slice(0, 8) ?? "...";

  return (
    <div>
      <PageHeader
        title={`Pipeline ${shortId}`}
        description="Pipeline run detail"
        actions={
          <Link to="/dashboard/pipelines">
            <Button variant="outline" size="sm">
              <ArrowLeft className="mr-1.5 h-3.5 w-3.5" />
              Back to Pipelines
            </Button>
          </Link>
        }
      />

      {isLoading ? (
        <ListSkeleton rows={3} />
      ) : error ? (
        <Card>
          <CardContent className="py-6">
            <div className="flex items-center gap-2 text-sm text-destructive">
              <AlertTriangle className="h-4 w-4" />
              <span>Failed to load pipeline: {error.message}</span>
            </div>
          </CardContent>
        </Card>
      ) : data ? (
        <div className="space-y-4">
          <Card>
            <CardContent className="py-4 space-y-3">
              <div className="flex items-center gap-3">
                <PipelineStateBadge state={data.state} />
                <span className="text-sm text-muted-foreground">
                  {data.stages.length} stage{data.stages.length !== 1 ? "s" : ""}
                </span>
              </div>
              {data.createdAt && (
                <p className="text-xs text-muted-foreground">
                  Created: {new Date(data.createdAt).toLocaleString()}
                </p>
              )}
              {data.finishedAt && (
                <p className="text-xs text-muted-foreground">
                  Finished: {new Date(data.finishedAt).toLocaleString()}
                </p>
              )}
              <p className="text-sm text-muted-foreground italic">
                Detailed stage view coming in Phase 6
              </p>
            </CardContent>
          </Card>
        </div>
      ) : null}
    </div>
  );
}
