import { useCallback, useRef } from "react";

interface UseResizableOptions {
  direction: "horizontal" | "vertical";
  onResize: (percentage: number) => void;
  containerRef: React.RefObject<HTMLElement | null>;
}

export function useResizable({ direction, onResize, containerRef }: UseResizableOptions) {
  const isDragging = useRef(false);

  const handlePointerDown = useCallback(
    (e: React.PointerEvent) => {
      e.preventDefault();
      isDragging.current = true;
      const target = e.currentTarget as HTMLElement;
      target.setPointerCapture(e.pointerId);

      const handlePointerMove = (ev: PointerEvent) => {
        if (!isDragging.current || !containerRef.current) return;
        const rect = containerRef.current.getBoundingClientRect();
        let pct: number;
        if (direction === "horizontal") {
          pct = ((ev.clientX - rect.left) / rect.width) * 100;
        } else {
          pct = ((ev.clientY - rect.top) / rect.height) * 100;
        }
        onResize(pct);
      };

      const handlePointerUp = () => {
        isDragging.current = false;
        document.removeEventListener("pointermove", handlePointerMove);
        document.removeEventListener("pointerup", handlePointerUp);
      };

      document.addEventListener("pointermove", handlePointerMove);
      document.addEventListener("pointerup", handlePointerUp);
    },
    [direction, onResize, containerRef],
  );

  return { handlePointerDown, isDragging };
}
