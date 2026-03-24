import { usePipelineTemplates } from "@/api/queries";
import { useTriggerPipelineTemplate } from "@/api/mutations";
import { PageHeader } from "@/components/layout/page-header";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { ListSkeleton } from "@/components/common/loading-skeleton";
import { usePageTitle } from "@/hooks/use-page-title";
import { formatDate } from "@/lib/utils";
import { LayoutTemplate, Play } from "lucide-react";

export function PipelineTemplatesPage() {
  usePageTitle("Pipeline Templates");
  const { data: templates, isLoading } = usePipelineTemplates();
  const trigger = useTriggerPipelineTemplate();

  return (
    <div>
      <PageHeader title="Pipeline Templates" description="Reusable pipeline stage configurations" />

      {isLoading ? (
        <ListSkeleton rows={4} />
      ) : !templates || templates.length === 0 ? (
        <div className="flex flex-col items-center justify-center py-12 text-center">
          <LayoutTemplate className="mb-3 h-8 w-8 text-muted-foreground" />
          <p className="text-sm font-medium">No pipeline templates</p>
          <p className="mt-1 text-xs text-muted-foreground">
            Create templates to define reusable pipeline configurations.
          </p>
        </div>
      ) : (
        <div className="space-y-3">
          {templates.map((t) => (
            <Card key={t.id}>
              <CardContent className="pt-4">
                <div className="flex items-start justify-between gap-3">
                  <div className="min-w-0 flex-1">
                    <div className="flex items-center gap-2">
                      <p className="text-sm font-medium">{t.name}</p>
                      <Badge variant={t.isActive ? "success" : "secondary"}>
                        {t.isActive ? "Active" : "Inactive"}
                      </Badge>
                      <Badge variant="outline">{(t.stages as unknown[]).length} stages</Badge>
                    </div>
                    {t.description && (
                      <p className="mt-1 text-sm text-muted-foreground">{t.description}</p>
                    )}
                    <p className="mt-1 text-xs text-muted-foreground">
                      Created {formatDate(t.createdAt)}
                    </p>
                  </div>
                  <Button
                    variant="outline"
                    size="sm"
                    disabled={!t.isActive || trigger.isPending}
                    onClick={() => trigger.mutate({ name: t.name })}
                  >
                    <Play className="mr-1 h-3 w-3" />
                    Trigger
                  </Button>
                </div>
              </CardContent>
            </Card>
          ))}
        </div>
      )}
    </div>
  );
}
