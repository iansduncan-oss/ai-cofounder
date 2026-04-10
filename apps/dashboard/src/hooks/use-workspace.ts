import { createContext, useContext, useState, useCallback, useEffect, useMemo } from "react";
import type { ReactNode } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import type { Workspace } from "@ai-cofounder/api-client";
import { apiClient, getStoredWorkspaceId, setStoredWorkspaceId } from "@/api/client";
import { queryKeys } from "@/lib/query-keys";
import { createElement } from "react";

interface WorkspaceContextValue {
  currentWorkspaceId: string | null;
  workspaces: Workspace[];
  isLoading: boolean;
  switchWorkspace: (id: string) => void;
}

const WorkspaceContext = createContext<WorkspaceContextValue>({
  currentWorkspaceId: null,
  workspaces: [],
  isLoading: true,
  switchWorkspace: () => {},
});

export function WorkspaceProvider({ children }: { children: ReactNode }) {
  const [currentId, setCurrentId] = useState<string | null>(getStoredWorkspaceId);
  const queryClient = useQueryClient();

  const { data, isLoading } = useQuery({
    queryKey: queryKeys.workspaces.list,
    queryFn: () => apiClient.listWorkspaces(),
  });

  const workspaces = useMemo(() => data?.workspaces ?? [], [data]);

  // Auto-select default workspace if none stored
  useEffect(() => {
    if (!currentId && workspaces.length > 0) {
      const defaultWs = workspaces.find((w) => w.isDefault) ?? workspaces[0];
      setCurrentId(defaultWs.id);
      setStoredWorkspaceId(defaultWs.id);
    }
  }, [currentId, workspaces]);

  const switchWorkspace = useCallback(
    (id: string) => {
      setCurrentId(id);
      setStoredWorkspaceId(id);
      // Invalidate all queries so they re-fetch with new workspace header
      queryClient.invalidateQueries();
    },
    [queryClient],
  );

  return createElement(
    WorkspaceContext.Provider,
    { value: { currentWorkspaceId: currentId, workspaces, isLoading, switchWorkspace } },
    children,
  );
}

export function useWorkspace() {
  return useContext(WorkspaceContext);
}
