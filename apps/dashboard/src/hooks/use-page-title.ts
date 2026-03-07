import { useEffect } from "react";

export function usePageTitle(title: string) {
  useEffect(() => {
    document.title = title ? `${title} | AI Cofounder` : "AI Cofounder";
    return () => {
      document.title = "AI Cofounder";
    };
  }, [title]);
}
