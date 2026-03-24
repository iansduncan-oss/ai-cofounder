import { renderHook, act } from "@testing-library/react";
import { useResizable } from "@/hooks/use-resizable";
import { useRef } from "react";

// jsdom doesn't have PointerEvent — polyfill it
class PointerEventPolyfill extends MouseEvent {
  readonly pointerId: number;
  constructor(type: string, params: PointerEventInit & MouseEventInit = {}) {
    super(type, params);
    this.pointerId = params.pointerId ?? 0;
  }
}
globalThis.PointerEvent = PointerEventPolyfill as unknown as typeof PointerEvent;

function createMockContainer(rect: Partial<DOMRect> = {}) {
  return {
    getBoundingClientRect: () => ({
      left: 0,
      top: 0,
      width: 1000,
      height: 800,
      right: 1000,
      bottom: 800,
      x: 0,
      y: 0,
      toJSON: () => ({}),
      ...rect,
    }),
  } as HTMLElement;
}

describe("useResizable", () => {
  it("returns handlePointerDown and isDragging ref", () => {
    const onResize = vi.fn();
    const { result } = renderHook(() => {
      const containerRef = useRef<HTMLElement>(createMockContainer());
      return useResizable({ direction: "horizontal", onResize, containerRef });
    });

    expect(result.current.handlePointerDown).toBeInstanceOf(Function);
    expect(result.current.isDragging.current).toBe(false);
  });

  it("sets isDragging to true on pointerdown", () => {
    const onResize = vi.fn();
    const { result } = renderHook(() => {
      const containerRef = useRef<HTMLElement>(createMockContainer());
      return useResizable({ direction: "horizontal", onResize, containerRef });
    });

    const mockTarget = {
      setPointerCapture: vi.fn(),
    };

    act(() => {
      result.current.handlePointerDown({
        preventDefault: vi.fn(),
        currentTarget: mockTarget,
        pointerId: 1,
      } as unknown as React.PointerEvent);
    });

    expect(result.current.isDragging.current).toBe(true);
    expect(mockTarget.setPointerCapture).toHaveBeenCalledWith(1);
  });

  it("calls onResize with horizontal percentage on pointermove", () => {
    const onResize = vi.fn();
    const { result } = renderHook(() => {
      const containerRef = useRef<HTMLElement>(createMockContainer());
      return useResizable({ direction: "horizontal", onResize, containerRef });
    });

    const mockTarget = { setPointerCapture: vi.fn() };

    act(() => {
      result.current.handlePointerDown({
        preventDefault: vi.fn(),
        currentTarget: mockTarget,
        pointerId: 1,
      } as unknown as React.PointerEvent);
    });

    // Simulate pointermove at clientX=500 on a 1000px wide container → 50%
    act(() => {
      document.dispatchEvent(
        new PointerEvent("pointermove", { clientX: 500, clientY: 0 }),
      );
    });

    expect(onResize).toHaveBeenCalledWith(50);
  });

  it("calls onResize with vertical percentage on pointermove", () => {
    const onResize = vi.fn();
    const { result } = renderHook(() => {
      const containerRef = useRef<HTMLElement>(createMockContainer());
      return useResizable({ direction: "vertical", onResize, containerRef });
    });

    const mockTarget = { setPointerCapture: vi.fn() };

    act(() => {
      result.current.handlePointerDown({
        preventDefault: vi.fn(),
        currentTarget: mockTarget,
        pointerId: 1,
      } as unknown as React.PointerEvent);
    });

    // Simulate pointermove at clientY=400 on an 800px tall container → 50%
    act(() => {
      document.dispatchEvent(
        new PointerEvent("pointermove", { clientX: 0, clientY: 400 }),
      );
    });

    expect(onResize).toHaveBeenCalledWith(50);
  });

  it("stops dragging on pointerup and cleans up listeners", () => {
    const onResize = vi.fn();
    const { result } = renderHook(() => {
      const containerRef = useRef<HTMLElement>(createMockContainer());
      return useResizable({ direction: "horizontal", onResize, containerRef });
    });

    const mockTarget = { setPointerCapture: vi.fn() };

    act(() => {
      result.current.handlePointerDown({
        preventDefault: vi.fn(),
        currentTarget: mockTarget,
        pointerId: 1,
      } as unknown as React.PointerEvent);
    });

    expect(result.current.isDragging.current).toBe(true);

    act(() => {
      document.dispatchEvent(new PointerEvent("pointerup"));
    });

    expect(result.current.isDragging.current).toBe(false);

    // Further pointermove should not trigger onResize
    onResize.mockClear();
    act(() => {
      document.dispatchEvent(
        new PointerEvent("pointermove", { clientX: 700, clientY: 0 }),
      );
    });

    expect(onResize).not.toHaveBeenCalled();
  });

  it("ignores pointermove when containerRef is null", () => {
    const onResize = vi.fn();
    const { result } = renderHook(() => {
      const containerRef = useRef<HTMLElement | null>(null);
      return useResizable({ direction: "horizontal", onResize, containerRef });
    });

    const mockTarget = { setPointerCapture: vi.fn() };

    act(() => {
      result.current.handlePointerDown({
        preventDefault: vi.fn(),
        currentTarget: mockTarget,
        pointerId: 1,
      } as unknown as React.PointerEvent);
    });

    act(() => {
      document.dispatchEvent(
        new PointerEvent("pointermove", { clientX: 500, clientY: 0 }),
      );
    });

    expect(onResize).not.toHaveBeenCalled();
  });
});
