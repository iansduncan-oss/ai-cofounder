import { renderHook } from "@testing-library/react";
import { usePageTitle } from "@/hooks/use-page-title";

describe("usePageTitle", () => {
  it("sets document title with suffix", () => {
    renderHook(() => usePageTitle("Chat"));
    expect(document.title).toBe("Chat | AI Cofounder");
  });

  it("resets title on unmount", () => {
    const { unmount } = renderHook(() => usePageTitle("Goals"));
    expect(document.title).toBe("Goals | AI Cofounder");

    unmount();
    expect(document.title).toBe("AI Cofounder");
  });

  it("updates title when prop changes", () => {
    const { rerender } = renderHook(({ title }) => usePageTitle(title), {
      initialProps: { title: "Chat" },
    });
    expect(document.title).toBe("Chat | AI Cofounder");

    rerender({ title: "Goals" });
    expect(document.title).toBe("Goals | AI Cofounder");
  });
});
