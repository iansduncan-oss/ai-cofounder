-- Fix provider_health integer overflow: change counters and latency from int4 to bigint
ALTER TABLE "provider_health" ALTER COLUMN "request_count" SET DATA TYPE bigint;
ALTER TABLE "provider_health" ALTER COLUMN "success_count" SET DATA TYPE bigint;
ALTER TABLE "provider_health" ALTER COLUMN "error_count" SET DATA TYPE bigint;
ALTER TABLE "provider_health" ALTER COLUMN "avg_latency_ms" SET DATA TYPE bigint;
