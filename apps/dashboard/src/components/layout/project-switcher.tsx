import { FolderOpen } from "lucide-react";
import { useProjects } from "@/api/queries";
import { useActiveProject, useSetActiveProject } from "@/hooks/use-active-project";

export function ProjectSwitcher() {
  const { data: projects } = useProjects();
  const activeProject = useActiveProject();
  const setActiveProject = useSetActiveProject();

  // Return nothing when no projects are registered
  if (!projects || projects.length === 0) {
    return null;
  }

  return (
    <div className="flex items-center gap-2 border-b px-4 py-2">
      <FolderOpen className="h-3.5 w-3.5 text-muted-foreground shrink-0" />
      <select
        value={activeProject ?? ""}
        onChange={(e) => setActiveProject(e.target.value || null)}
        className="text-xs h-7 w-full rounded border bg-background px-2 text-foreground"
        aria-label="Switch active project"
      >
        <option value="">All projects</option>
        {projects.map((project) => (
          <option key={project.id} value={project.id}>
            {project.name}
          </option>
        ))}
      </select>
    </div>
  );
}
