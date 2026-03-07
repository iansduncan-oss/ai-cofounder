import { useState, useEffect } from "react";
import { formatRelativeTime } from "@/lib/utils";

interface RelativeTimeProps {
  date: string;
  className?: string;
}

export function RelativeTime({ date, className }: RelativeTimeProps) {
  const [, setTick] = useState(0);

  useEffect(() => {
    const interval = setInterval(() => setTick((t) => t + 1), 60_000);
    return () => clearInterval(interval);
  }, []);

  return <span className={className}>{formatRelativeTime(date)}</span>;
}
