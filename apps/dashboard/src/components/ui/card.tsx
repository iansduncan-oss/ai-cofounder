import { type HTMLAttributes, forwardRef } from "react";
import { cn } from "@/lib/utils";

type CardVariant = "default" | "panel" | "metric";

interface CardProps extends HTMLAttributes<HTMLDivElement> {
  variant?: CardVariant;
  glowColor?: "chat" | "goals" | "monitor";
}

const variantStyles: Record<CardVariant, string> = {
  default: "rounded-lg border bg-card text-card-foreground shadow-sm",
  panel: "rounded-lg border bg-surface-1 text-card-foreground shadow-sm",
  metric: "rounded-lg border bg-surface-1 text-card-foreground shadow-sm",
};

const glowStyles: Record<string, string> = {
  chat: "panel-glow-chat",
  goals: "panel-glow-goals",
  monitor: "panel-glow-monitor",
};

const Card = forwardRef<HTMLDivElement, CardProps>(
  ({ className, variant = "default", glowColor, ...props }, ref) => (
    <div
      ref={ref}
      className={cn(
        variantStyles[variant],
        glowColor && glowStyles[glowColor],
        className,
      )}
      {...props}
    />
  ),
);
Card.displayName = "Card";

const CardHeader = forwardRef<HTMLDivElement, HTMLAttributes<HTMLDivElement>>(
  ({ className, ...props }, ref) => (
    <div
      ref={ref}
      className={cn("flex flex-col space-y-1.5 p-6", className)}
      {...props}
    />
  ),
);
CardHeader.displayName = "CardHeader";

const CardTitle = forwardRef<
  HTMLHeadingElement,
  HTMLAttributes<HTMLHeadingElement>
>(({ className, ...props }, ref) => (
  <h2
    ref={ref}
    className={cn("font-semibold leading-none tracking-tight", className)}
    {...props}
  />
));
CardTitle.displayName = "CardTitle";

const CardDescription = forwardRef<
  HTMLParagraphElement,
  HTMLAttributes<HTMLParagraphElement>
>(({ className, ...props }, ref) => (
  <p
    ref={ref}
    className={cn("text-sm text-muted-foreground", className)}
    {...props}
  />
));
CardDescription.displayName = "CardDescription";

const CardContent = forwardRef<HTMLDivElement, HTMLAttributes<HTMLDivElement>>(
  ({ className, ...props }, ref) => (
    <div ref={ref} className={cn("p-6 pt-0", className)} {...props} />
  ),
);
CardContent.displayName = "CardContent";

export { Card, CardHeader, CardTitle, CardDescription, CardContent };
