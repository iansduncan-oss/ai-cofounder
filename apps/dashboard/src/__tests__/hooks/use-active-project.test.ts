import { renderHook, act } from "@testing-library/react";
import { useActiveProject, useSetActiveProject } from "@/hooks/use-active-project";

// jsdom rejects StorageEvent with a mock storageArea (not a real Storage).
// Patch the constructor to strip storageArea before calling the real one.
const RealStorageEvent = globalThis.StorageEvent;
beforeEach(() => {
  globalThis.StorageEvent = class extends RealStorageEvent {
    constructor(type: string, init?: StorageEventInit) {
      const { storageArea: _sa, ...rest } = init ?? {};
      super(type, rest);
    }
  } as typeof StorageEvent;
});
afterEach(() => {
  globalThis.StorageEvent = RealStorageEvent;
});

describe("useActiveProject", () => {
  it("returns null when no stored value", () => {
    const { result } = renderHook(() => useActiveProject());
    expect(result.current).toBeNull();
  });

  it("reads existing value from localStorage", () => {
    localStorage.setItem("ai-cofounder-active-project-id", "proj-123");
    const { result } = renderHook(() => useActiveProject());
    expect(result.current).toBe("proj-123");
  });

  it("re-renders when StorageEvent is dispatched", () => {
    const { result } = renderHook(() => useActiveProject());
    expect(result.current).toBeNull();

    act(() => {
      localStorage.setItem("ai-cofounder-active-project-id", "proj-456");
      window.dispatchEvent(
        new StorageEvent("storage", {
          key: "ai-cofounder-active-project-id",
          newValue: "proj-456",
        }),
      );
    });

    expect(result.current).toBe("proj-456");
  });

  it("ignores StorageEvents for other keys", () => {
    const { result } = renderHook(() => useActiveProject());
    expect(result.current).toBeNull();

    act(() => {
      window.dispatchEvent(
        new StorageEvent("storage", {
          key: "some-other-key",
          newValue: "value",
        }),
      );
    });

    expect(result.current).toBeNull();
  });
});

describe("useSetActiveProject", () => {
  it("sets value in localStorage and dispatches event", () => {
    const { result } = renderHook(() => useSetActiveProject());

    act(() => {
      result.current("proj-789");
    });

    expect(localStorage.setItem).toHaveBeenCalledWith(
      "ai-cofounder-active-project-id",
      "proj-789",
    );
  });

  it("removes from localStorage when set to null", () => {
    localStorage.setItem("ai-cofounder-active-project-id", "proj-123");
    const { result } = renderHook(() => useSetActiveProject());

    act(() => {
      result.current(null);
    });

    expect(localStorage.removeItem).toHaveBeenCalledWith(
      "ai-cofounder-active-project-id",
    );
  });

  it("triggers useActiveProject to re-render", () => {
    const { result: activeResult } = renderHook(() => useActiveProject());
    const { result: setResult } = renderHook(() => useSetActiveProject());

    expect(activeResult.current).toBeNull();

    act(() => {
      setResult.current("proj-new");
    });

    expect(activeResult.current).toBe("proj-new");
  });
});
