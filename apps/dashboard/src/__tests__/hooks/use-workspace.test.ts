import { renderHook, act, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { createElement, type ReactNode } from "react";

// Mock api client
const mockListWorkspaces = vi.fn();
const mockSetStoredWorkspaceId = vi.fn();
const mockGetStoredWorkspaceId = vi.fn().mockReturnValue(null);

vi.mock("@/api/client", () => ({
  apiClient: {
    listWorkspaces: (...args: unknown[]) => mockListWorkspaces(...args),
  },
  getStoredWorkspaceId: () => mockGetStoredWorkspaceId(),
  setStoredWorkspaceId: (id: string | null) => mockSetStoredWorkspaceId(id),
}));

vi.mock("@/lib/query-keys", () => ({
  queryKeys: {
    workspaces: {
      list: ["workspaces", "list"],
    },
  },
}));

import { WorkspaceProvider, useWorkspace } from "@/hooks/use-workspace";

function createWrapper() {
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  });
  return {
    queryClient,
    wrapper: ({ children }: { children: ReactNode }) =>
      createElement(
        QueryClientProvider,
        { client: queryClient },
        createElement(WorkspaceProvider, null, children),
      ),
  };
}

describe("useWorkspace", () => {
  it("returns context values", async () => {
    mockListWorkspaces.mockResolvedValue({ workspaces: [] });
    const { wrapper } = createWrapper();

    const { result } = renderHook(() => useWorkspace(), { wrapper });

    expect(result.current.currentWorkspaceId).toBeNull();
    expect(result.current.workspaces).toEqual([]);
    expect(result.current.switchWorkspace).toBeInstanceOf(Function);
  });

  it("auto-selects default workspace when none stored", async () => {
    const workspaces = [
      { id: "ws-1", name: "First", isDefault: false },
      { id: "ws-2", name: "Default", isDefault: true },
    ];
    mockListWorkspaces.mockResolvedValue({ workspaces });
    mockGetStoredWorkspaceId.mockReturnValue(null);

    const { wrapper } = createWrapper();
    const { result } = renderHook(() => useWorkspace(), { wrapper });

    await waitFor(() => {
      expect(result.current.currentWorkspaceId).toBe("ws-2");
    });

    expect(mockSetStoredWorkspaceId).toHaveBeenCalledWith("ws-2");
  });

  it("auto-selects first workspace when no default exists", async () => {
    const workspaces = [
      { id: "ws-1", name: "First", isDefault: false },
      { id: "ws-2", name: "Second", isDefault: false },
    ];
    mockListWorkspaces.mockResolvedValue({ workspaces });
    mockGetStoredWorkspaceId.mockReturnValue(null);

    const { wrapper } = createWrapper();
    const { result } = renderHook(() => useWorkspace(), { wrapper });

    await waitFor(() => {
      expect(result.current.currentWorkspaceId).toBe("ws-1");
    });

    expect(mockSetStoredWorkspaceId).toHaveBeenCalledWith("ws-1");
  });

  it("uses stored workspace ID on init", async () => {
    mockListWorkspaces.mockResolvedValue({
      workspaces: [{ id: "ws-stored", name: "Stored", isDefault: false }],
    });
    mockGetStoredWorkspaceId.mockReturnValue("ws-stored");

    const { wrapper } = createWrapper();
    const { result } = renderHook(() => useWorkspace(), { wrapper });

    // Should use the stored ID immediately, not wait for query
    expect(result.current.currentWorkspaceId).toBe("ws-stored");
  });

  it("switchWorkspace updates current ID and persists", async () => {
    const workspaces = [
      { id: "ws-1", name: "First", isDefault: true },
      { id: "ws-2", name: "Second", isDefault: false },
    ];
    mockListWorkspaces.mockResolvedValue({ workspaces });
    mockGetStoredWorkspaceId.mockReturnValue("ws-1");

    const { wrapper } = createWrapper();
    const { result } = renderHook(() => useWorkspace(), { wrapper });

    await waitFor(() => {
      expect(result.current.workspaces.length).toBe(2);
    });

    act(() => {
      result.current.switchWorkspace("ws-2");
    });

    expect(result.current.currentWorkspaceId).toBe("ws-2");
    expect(mockSetStoredWorkspaceId).toHaveBeenCalledWith("ws-2");
  });

  it("switchWorkspace invalidates queries", async () => {
    const workspaces = [{ id: "ws-1", name: "First", isDefault: true }];
    mockListWorkspaces.mockResolvedValue({ workspaces });
    mockGetStoredWorkspaceId.mockReturnValue("ws-1");

    const { queryClient, wrapper } = createWrapper();
    const invalidateSpy = vi.spyOn(queryClient, "invalidateQueries");

    const { result } = renderHook(() => useWorkspace(), { wrapper });

    await waitFor(() => {
      expect(result.current.workspaces.length).toBe(1);
    });

    act(() => {
      result.current.switchWorkspace("ws-new");
    });

    expect(invalidateSpy).toHaveBeenCalled();
  });

  it("shows loading state while fetching", () => {
    // Never resolve the promise to keep loading state
    mockListWorkspaces.mockReturnValue(new Promise(() => {}));
    mockGetStoredWorkspaceId.mockReturnValue(null);

    const { wrapper } = createWrapper();
    const { result } = renderHook(() => useWorkspace(), { wrapper });

    expect(result.current.isLoading).toBe(true);
    expect(result.current.workspaces).toEqual([]);
  });
});
