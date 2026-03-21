/**
 * OpenTelemetry initialization module.
 *
 * Opt-in via OTEL_ENABLED=true. When disabled every export is a no-op
 * so the rest of the codebase can reference telemetry helpers without
 * guarding on feature flags.
 */

import { type Tracer, type Meter, type Counter, type Histogram } from "@opentelemetry/api";

// ---------------------------------------------------------------------------
// State
// ---------------------------------------------------------------------------

let sdkInstance: InstanceType<typeof import("@opentelemetry/sdk-node").NodeSDK> | null = null;
let _tracer: Tracer | null = null;
let _meter: Meter | null = null;

// Custom metrics (initialised in initTelemetry, stubs until then)
export let callProcessingDuration: Histogram;
export let callsProcessedTotal: Counter;
export let aiAnalysisDuration: Histogram;
export let activeUsers: ReturnType<Meter["createUpDownCounter"]>;

const enabled = process.env.OTEL_ENABLED === "true";

// ---------------------------------------------------------------------------
// No-op stubs used when telemetry is disabled
// ---------------------------------------------------------------------------

const noopCounter = { add: () => {} } as unknown as Counter;
const noopHistogram = { record: () => {} } as unknown as Histogram;
const noopUpDownCounter = { add: () => {} } as unknown as ReturnType<Meter["createUpDownCounter"]>;

// Pre-fill with no-ops so callers never need null-checks
callProcessingDuration = noopHistogram;
callsProcessedTotal = noopCounter;
aiAnalysisDuration = noopHistogram;
activeUsers = noopUpDownCounter;

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

/**
 * Initialise the OpenTelemetry NodeSDK.
 * Must be called **before** any other imports that should be auto-instrumented
 * (HTTP, Express, pg).  Safe to call when OTEL_ENABLED !== "true" — it will
 * simply return without doing anything.
 */
export async function initTelemetry(): Promise<void> {
  if (!enabled) return;

  // Dynamic imports so the otel packages are only loaded when needed
  const { NodeSDK } = await import("@opentelemetry/sdk-node");
  const { OTLPTraceExporter } = await import("@opentelemetry/exporter-trace-otlp-http");
  const { OTLPMetricExporter } = await import("@opentelemetry/exporter-metrics-otlp-http");
  const { PeriodicExportingMetricReader } = await import("@opentelemetry/sdk-metrics");
  const { getNodeAutoInstrumentations } = await import("@opentelemetry/auto-instrumentations-node");
  const { resourceFromAttributes } = await import("@opentelemetry/resources");
  const { ATTR_SERVICE_NAME, ATTR_SERVICE_VERSION } = await import("@opentelemetry/semantic-conventions");
  const otelApi = await import("@opentelemetry/api");

  const endpoint =
    process.env.OTEL_EXPORTER_OTLP_ENDPOINT || "http://localhost:4318";

  const resource = resourceFromAttributes({
    [ATTR_SERVICE_NAME]: "observatory-qa",
    [ATTR_SERVICE_VERSION]: "1.0.0",
  });

  const traceExporter = new OTLPTraceExporter({ url: `${endpoint}/v1/traces` });
  const metricExporter = new OTLPMetricExporter({ url: `${endpoint}/v1/metrics` });

  const metricReader = new PeriodicExportingMetricReader({
    exporter: metricExporter,
    exportIntervalMillis: 30_000,
  });

  const sdk = new NodeSDK({
    resource,
    traceExporter,
    metricReader,
    instrumentations: [
      getNodeAutoInstrumentations({
        // Only enable the instrumentations we care about
        "@opentelemetry/instrumentation-http": { enabled: true },
        "@opentelemetry/instrumentation-express": { enabled: true },
        "@opentelemetry/instrumentation-pg": { enabled: true },
        // Disable noisy / unused auto-instrumentations
        "@opentelemetry/instrumentation-fs": { enabled: false },
        "@opentelemetry/instrumentation-dns": { enabled: false },
        "@opentelemetry/instrumentation-net": { enabled: false },
      }),
    ],
  });

  sdk.start();
  sdkInstance = sdk;

  // Build real tracer & meter
  _tracer = otelApi.trace.getTracer("observatory-qa");
  _meter = otelApi.metrics.getMeter("observatory-qa");

  // Create custom metrics
  callProcessingDuration = _meter.createHistogram("call_processing_duration_ms", {
    description: "Duration of call processing pipeline in milliseconds",
    unit: "ms",
  });

  callsProcessedTotal = _meter.createCounter("calls_processed_total", {
    description: "Total number of calls processed",
  });

  aiAnalysisDuration = _meter.createHistogram("ai_analysis_duration_ms", {
    description: "Duration of AI analysis step in milliseconds",
    unit: "ms",
  });

  activeUsers = _meter.createUpDownCounter("active_users", {
    description: "Number of active user sessions",
  });

  console.log(`[telemetry] OpenTelemetry initialised — exporting to ${endpoint}`);
}

/**
 * Gracefully shut down the SDK, flushing any pending spans/metrics.
 */
export async function shutdownTelemetry(): Promise<void> {
  if (sdkInstance) {
    await sdkInstance.shutdown();
    sdkInstance = null;
  }
}

/**
 * Return a named Tracer.  Returns the OTel API no-op tracer when disabled.
 */
export function getTracer(name?: string): Tracer {
  if (!enabled) {
    // Lazy-import avoided: just use the api default no-op tracer
    // We dynamically import only when called the first time while disabled
    // to avoid top-level otel/api import.
    return {
      startSpan: () => ({
        end: () => {},
        setAttribute: () => ({}),
        setStatus: () => ({}),
        recordException: () => {},
        addEvent: () => ({}),
        isRecording: () => false,
        spanContext: () => ({ traceId: "", spanId: "", traceFlags: 0 }),
        updateName: () => ({}),
      }),
      startActiveSpan: (_name: string, fn: any) => fn({
        end: () => {},
        setAttribute: () => ({}),
        setStatus: () => ({}),
        recordException: () => {},
        addEvent: () => ({}),
        isRecording: () => false,
        spanContext: () => ({ traceId: "", spanId: "", traceFlags: 0 }),
        updateName: () => ({}),
      }),
    } as unknown as Tracer;
  }
  if (_tracer && !name) return _tracer;
  // If a custom name is requested (or tracer not yet ready), use api
  try {
    const otelApi = require("@opentelemetry/api");
    return otelApi.trace.getTracer(name || "observatory-qa");
  } catch {
    return _tracer!;
  }
}

/**
 * Return a named Meter.  Returns a no-op meter when disabled.
 */
export function getMeter(name?: string): Meter {
  if (!enabled) {
    return {
      createCounter: () => noopCounter,
      createHistogram: () => noopHistogram,
      createUpDownCounter: () => noopUpDownCounter,
      createObservableCounter: () => ({}),
      createObservableGauge: () => ({}),
      createObservableUpDownCounter: () => ({}),
    } as unknown as Meter;
  }
  if (_meter && !name) return _meter;
  try {
    const otelApi = require("@opentelemetry/api");
    return otelApi.metrics.getMeter(name || "observatory-qa");
  } catch {
    return _meter!;
  }
}
