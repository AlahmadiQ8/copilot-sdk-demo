// telemetry.ts — Must be imported BEFORE all other modules so OpenTelemetry patches them.
import { useAzureMonitor, AzureMonitorOpenTelemetryOptions } from "@azure/monitor-opentelemetry";
import { metrics, DiagConsoleLogger, DiagLogLevel, diag } from "@opentelemetry/api";

const connectionString = process.env.APPLICATIONINSIGHTS_CONNECTION_STRING;

if (connectionString) {
  diag.setLogger(new DiagConsoleLogger(), DiagLogLevel.WARN);

  const options: AzureMonitorOpenTelemetryOptions = {
    azureMonitorExporterOptions: { connectionString },
    instrumentationOptions: {
      http: { enabled: true },
    },
  };
  useAzureMonitor(options);
  console.log("✅ Azure Monitor OpenTelemetry initialized");
} else {
  console.log("ℹ️  APPLICATIONINSIGHTS_CONNECTION_STRING not set — telemetry disabled");
}

// ---------------------------------------------------------------------------
// Custom metrics
// ---------------------------------------------------------------------------
const meter = metrics.getMeter("copilot-sdk-api");

export const chatRequestCounter = meter.createCounter("chat_requests_total", {
  description: "Total number of /chat requests",
});

export const chatErrorCounter = meter.createCounter("chat_errors_total", {
  description: "Total number of /chat errors",
});

export const chatDurationHistogram = meter.createHistogram("chat_duration_ms", {
  description: "Duration of /chat requests in milliseconds",
  unit: "ms",
});

export const summarizeRequestCounter = meter.createCounter("summarize_requests_total", {
  description: "Total number of /summarize requests",
});

export const summarizeErrorCounter = meter.createCounter("summarize_errors_total", {
  description: "Total number of /summarize errors",
});

export const summarizeDurationHistogram = meter.createHistogram("summarize_duration_ms", {
  description: "Duration of /summarize requests in milliseconds",
  unit: "ms",
});

// Conversation store metrics
export const conversationsCreatedCounter = meter.createCounter("conversations_created_total", {
  description: "Total conversations created",
});

export const conversationsDeletedCounter = meter.createCounter("conversations_deleted_total", {
  description: "Total conversations deleted",
});

export const conversationMessagesCounter = meter.createCounter("conversation_messages_total", {
  description: "Total messages added to conversations",
});

export const cosmosErrorCounter = meter.createCounter("cosmos_errors_total", {
  description: "Total Cosmos DB operation errors",
});

export const cosmosDurationHistogram = meter.createHistogram("cosmos_duration_ms", {
  description: "Duration of Cosmos DB operations in milliseconds",
  unit: "ms",
});

// ---------------------------------------------------------------------------
// Structured logger — emits to OpenTelemetry (→ App Insights traces table)
// and to console (→ ContainerAppConsoleLogs_CL)
// ---------------------------------------------------------------------------
import { logs, SeverityNumber } from "@opentelemetry/api-logs";

const otelLogger = logs.getLogger("copilot-sdk-api");

const SEVERITY: Record<string, SeverityNumber> = {
  info: SeverityNumber.INFO,
  warn: SeverityNumber.WARN,
  error: SeverityNumber.ERROR,
};

export type LogLevel = "info" | "warn" | "error";

export function log(level: LogLevel, message: string, attributes?: Record<string, unknown>) {
  // Emit to OpenTelemetry → traces table in App Insights
  otelLogger.emit({
    severityNumber: SEVERITY[level],
    severityText: level.toUpperCase(),
    body: message,
    attributes: attributes as Record<string, string | number | boolean>,
  });

  // Also emit to console → ContainerAppConsoleLogs_CL
  const entry = { timestamp: new Date().toISOString(), level, message, ...attributes };
  const fn = level === "error" ? console.error : level === "warn" ? console.warn : console.log;
  fn(JSON.stringify(entry));
}
