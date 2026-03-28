import pino from "pino";

const REDACTED_HEADERS = ["authorization", "cookie", "x-api-key", "x-auth-token"];

export function createLogger(name: string) {
  return pino({
    name,
    level: process.env.LOG_LEVEL || "info",
    serializers: {
      err: pino.stdSerializers.err,
      req(request: unknown) {
        const base = pino.stdSerializers.req(request as never) as unknown as Record<string, unknown>;
        if (base.headers && typeof base.headers === "object") {
          const headers = { ...(base.headers as Record<string, unknown>) };
          for (const h of REDACTED_HEADERS) {
            if (h in headers) headers[h] = "[Redacted]";
          }
          base.headers = headers;
        }
        return base;
      },
    },
    redact: [
      "*.password",
      "*.apiKey",
      "*.secret",
      "*.token",
      "*.DATABASE_URL",
      "*.accessToken",
      "*.refreshToken",
      "*.creditCard",
    ],
    ...(process.env.NODE_ENV !== "production" && {
      transport: {
        target: "pino/file",
        options: { destination: 1 }, // stdout
      },
    }),
  });
}

export type Logger = ReturnType<typeof createLogger>;
