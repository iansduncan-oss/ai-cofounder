import pino from "pino";

export function createLogger(name: string) {
  return pino({
    name,
    level: process.env.LOG_LEVEL || "info",
    ...(process.env.NODE_ENV !== "production" && {
      transport: {
        target: "pino/file",
        options: { destination: 1 }, // stdout
      },
    }),
  });
}

export type Logger = ReturnType<typeof createLogger>;
