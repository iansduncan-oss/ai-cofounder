import { NodeSDK } from "@opentelemetry/sdk-node";
import { OTLPTraceExporter } from "@opentelemetry/exporter-trace-otlp-http";
import { HttpInstrumentation } from "@opentelemetry/instrumentation-http";
import { FastifyInstrumentation } from "@opentelemetry/instrumentation-fastify";
import { resourceFromAttributes } from "@opentelemetry/resources";
import { ATTR_SERVICE_NAME, ATTR_SERVICE_VERSION } from "@opentelemetry/semantic-conventions";
import { ConsoleSpanExporter } from "@opentelemetry/sdk-trace-node";
import { createLogger, optionalEnv } from "@ai-cofounder/shared";

const logger = createLogger("tracing");

let sdk: NodeSDK | undefined;

export function initTracing(): void {
  const otlpEndpoint = optionalEnv("OTEL_EXPORTER_OTLP_ENDPOINT", "");

  if (!otlpEndpoint) {
    logger.info("OTEL_EXPORTER_OTLP_ENDPOINT not set, tracing disabled");
    return;
  }

  const exporter =
    otlpEndpoint === "console"
      ? new ConsoleSpanExporter()
      : new OTLPTraceExporter({ url: `${otlpEndpoint}/v1/traces` });

  sdk = new NodeSDK({
    resource: resourceFromAttributes({
      [ATTR_SERVICE_NAME]: "ai-cofounder-agent-server",
      [ATTR_SERVICE_VERSION]: "0.1.0",
    }),
    traceExporter: exporter,
    instrumentations: [new HttpInstrumentation(), new FastifyInstrumentation()],
  });

  sdk.start();
  logger.info({ endpoint: otlpEndpoint }, "OpenTelemetry tracing initialized");
}

export async function shutdownTracing(): Promise<void> {
  if (sdk) {
    await sdk.shutdown();
    logger.info("OpenTelemetry tracing shut down");
  }
}
