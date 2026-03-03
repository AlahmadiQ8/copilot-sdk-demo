# SRE Troubleshooting Guide — Copilot SDK Service

## Architecture Overview

This is a two-container app deployed on Azure Container Apps:

| Component | Resource Name Pattern | Purpose |
|---|---|---|
| **API** | `ca-api-{env}-{suffix}` | Express API (Node 24) — internal only, not externally accessible |
| **Web** | `ca-web-{env}-{suffix}` | React + nginx — external-facing, proxies to API |
| **Container Apps Environment** | `cae-{env}-{suffix}` | Shared environment for both containers |
| **Container Registry** | `acr{shortname}{suffix}` | Docker image storage |
| **Application Insights** | `ai-{env}-{suffix}` | APM, request tracing, custom metrics, structured logs |
| **Log Analytics Workspace** | `law-{env}-{suffix}` | Backing store for App Insights, KQL query engine |
| **Key Vault** | `kv-{shortname}-{suffix}` | Stores `GITHUB_TOKEN` secret |
| **Managed Identity** | `id-{env}-{suffix}` | RBAC access to Key Vault and optional Azure OpenAI |
| **Azure OpenAI** *(optional)* | `oai-{env}-{suffix}` | BYOM endpoint (only when `useAzureModel=true`) |

### Request Flow

```
User → Web (nginx :80) → API (Express :3000) → Copilot SDK → GitHub/Azure OpenAI
```

The web container proxies `/chat`, `/summarize`, `/health`, and `/config` to the internal API container.

### API Endpoints

| Endpoint | Method | Description |
|---|---|---|
| `/chat` | POST | Multi-turn chat with SSE streaming. Body: `{ message, history? }` |
| `/summarize` | POST | One-shot text summarization. Body: `{ text }` |
| `/health` | GET | Health check — returns `{ status, uptime, telemetry }` |
| `/config` | GET | Model configuration — returns `{ model, provider }` |

### Model Configuration (3 paths)

| `MODEL_PROVIDER` | `MODEL_NAME` | Effect |
|---|---|---|
| *(unset)* | *(unset)* | GitHub default model |
| *(unset)* | e.g. `gpt-4o` | GitHub specific model |
| `azure` | e.g. `o4-mini` | Azure BYOM (requires `AZURE_OPENAI_ENDPOINT`) |

---

## Observability Stack

### Telemetry Pipeline

The API uses `@azure/monitor-opentelemetry` initialized **before** Express loads, which auto-instruments HTTP requests and dependencies. Custom instrumentation adds:

- **Counters**: `chat_requests_total`, `chat_errors_total`, `summarize_requests_total`, `summarize_errors_total`
- **Histograms**: `chat_duration_ms`, `summarize_duration_ms`
- **Structured logs**: Emitted via OpenTelemetry Logs API with attributes `{ route, model, provider, durationMs, error }`

All telemetry flows through `APPLICATIONINSIGHTS_CONNECTION_STRING` (injected from Bicep).

### Log Analytics Tables

| Table | What It Contains | Key Columns |
|---|---|---|
| `AppRequests` | HTTP request traces (auto-collected) | `Name`, `ResultCode`, `DurationMs`, `Success`, `Properties`, `OperationId` |
| `AppTraces` | Structured logs from `log()` calls | `Message`, `SeverityLevel`, `Properties`, `OperationId` |
| `AppPerformanceCounters` | CPU, memory, request rate (auto-collected) | `Name`, `Value` |
| `AppMetrics` | SDK telemetry export metrics | `Name`, `Sum`, `Properties` |
| `AppExceptions` | Unhandled exceptions (auto-collected) | `ExceptionType`, `OuterMessage`, `Properties` |
| `AppDependencies` | Outbound HTTP calls (auto-collected) | `Name`, `Target`, `DurationMs`, `Success` |

### AppTraces Structured Log Fields

The `Properties` column in `AppTraces` contains these custom attributes:

| Field | Type | Description |
|---|---|---|
| `route` | string | `/chat` or `/summarize` |
| `model` | string | Model name or `(default)` |
| `provider` | string | `github` or `azure` |
| `durationMs` | number | Request duration in ms (on completed/failed) |
| `historyLength` | number | Chat history length (chat only) |
| `textLength` | number | Input text length (summarize only) |
| `error` | string | Error message (on failure only) |

### SeverityLevel Mapping

| Level | Number | Meaning |
|---|---|---|
| INFO | 1 | Request started / completed |
| WARN | 2 | Configuration warnings |
| ERROR | 3 | Request failures, timeouts |

---

## KQL Queries for Troubleshooting

### Health Check

```kql
// Is the API receiving traffic?
AppRequests
| where TimeGenerated > ago(1h)
| summarize count() by Name, ResultCode
| order by count_ desc
```

```kql
// Check if telemetry pipeline is healthy
AppPerformanceCounters
| where TimeGenerated > ago(15m)
| distinct Name
```

### Request Performance

```kql
// Request latency percentiles by endpoint
AppRequests
| where TimeGenerated > ago(24h)
| summarize
    p50 = percentile(DurationMs, 50),
    p95 = percentile(DurationMs, 95),
    p99 = percentile(DurationMs, 99),
    count = count()
  by Name
```

```kql
// Slow requests (> 10s)
AppRequests
| where TimeGenerated > ago(24h)
| where DurationMs > 10000
| project TimeGenerated, Name, DurationMs, ResultCode, Properties
| order by DurationMs desc
```

```kql
// Request trend over time (5-min buckets)
AppRequests
| where TimeGenerated > ago(6h)
| summarize count() by bin(TimeGenerated, 5m), Name
| render timechart
```

### Error Investigation

```kql
// All errors
AppTraces
| where TimeGenerated > ago(24h)
| where SeverityLevel >= 3
| project TimeGenerated, Message, Properties
| order by TimeGenerated desc
```

```kql
// Error rate by endpoint
AppTraces
| where TimeGenerated > ago(24h)
| extend route = tostring(Properties.route)
| summarize
    errors = countif(SeverityLevel >= 3),
    total = count()
  by route
| extend error_rate = round(100.0 * errors / total, 2)
```

```kql
// Timeout errors specifically
AppTraces
| where TimeGenerated > ago(24h)
| where SeverityLevel >= 3
| where Message contains "Timeout"
| project TimeGenerated, Properties
| order by TimeGenerated desc
```

```kql
// Unhandled exceptions
AppExceptions
| where TimeGenerated > ago(24h)
| project TimeGenerated, ExceptionType, OuterMessage, Properties
| order by TimeGenerated desc
```

### Failed requests with correlated logs

```kql
// Find a failed request and its traces
AppRequests
| where TimeGenerated > ago(24h)
| where Success == false
| project TimeGenerated, Name, DurationMs, OperationId
| take 10
```

```kql
// Then correlate by OperationId (replace value below)
union AppRequests, AppTraces, AppExceptions, AppDependencies
| where OperationId == "<OPERATION_ID>"
| project TimeGenerated, $table, Name, Message, DurationMs, SeverityLevel
| order by TimeGenerated asc
```

### Model & Provider Analysis

```kql
// Requests by model and provider
AppTraces
| where TimeGenerated > ago(24h)
| where Message startswith "Chat request" or Message startswith "Summarize request"
| extend model = tostring(Properties.model), provider = tostring(Properties.provider)
| summarize count() by model, provider
```

```kql
// Average duration by model
AppTraces
| where TimeGenerated > ago(24h)
| where Message contains "completed"
| extend durationMs = todouble(Properties.durationMs), model = tostring(Properties.model)
| summarize avg(durationMs), percentile(durationMs, 95) by model
```

### Infrastructure Health

```kql
// CPU and memory usage
AppPerformanceCounters
| where TimeGenerated > ago(1h)
| where Name in ("% Processor Time", "Available Bytes", "Private Bytes")
| summarize avg(Value) by Name, bin(TimeGenerated, 5m)
| render timechart
```

```kql
// Request throughput
AppPerformanceCounters
| where TimeGenerated > ago(1h)
| where Name == "Requests/Sec"
| summarize avg(Value) by bin(TimeGenerated, 5m)
| render timechart
```

---

## Common Issues & Runbooks

### 1. Chat requests timing out

**Symptom**: `AppTraces` shows `"Timeout after 120000ms waiting for response"`.

**Check**:
```kql
AppTraces
| where TimeGenerated > ago(1h)
| where Message == "Chat request failed"
| where Properties contains "Timeout"
| summarize count() by bin(TimeGenerated, 5m)
| render timechart
```

**Possible causes**:
- Copilot SDK subprocess hung — check if the container needs restart
- Model provider (GitHub/Azure OpenAI) is slow or down
- Input prompt too large (long history)

**Remediation**: Check GitHub status page or Azure OpenAI health. If persistent, restart the container app revision.

### 2. All AI endpoints returning errors

**Symptom**: `/chat` and `/summarize` both fail, `/health` returns `200`.

**Check**:
```kql
AppTraces
| where TimeGenerated > ago(1h)
| where SeverityLevel >= 3
| project TimeGenerated, Message, Properties
```

**Possible causes**:
- `GITHUB_TOKEN` expired or missing — check Key Vault secret
- Model not supported (encrypted content error) — check `MODEL_NAME`
- Azure BYOM credential failure — check managed identity role assignment

### 3. No telemetry data

**Symptom**: App Insights tables are empty.

**Check**: Hit `/health` and verify `"telemetry": true` in the response.

**Possible causes**:
- `APPLICATIONINSIGHTS_CONNECTION_STRING` not set — check container app env vars
- App not yet deployed with instrumentation code
- Ingestion delay (wait 3–10 minutes after first request)

### 4. High latency on /chat

**Symptom**: `DurationMs` consistently > 30s.

**Check**:
```kql
AppRequests
| where TimeGenerated > ago(6h)
| where Name == "POST /chat"
| summarize avg(DurationMs), percentile(DurationMs, 95) by bin(TimeGenerated, 15m)
| render timechart
```

**Possible causes**:
- Long conversation history increasing prompt size
- Model cold start (first request after idle)
- SSE streaming overhead
- Container resource constraints (check CPU/memory counters)

### 5. Web UI can't connect to API

**Symptom**: Web frontend shows connection errors or CORS errors.

**Check**:
- API container is running: `az containerapp revision list --name ca-api-{env}-{suffix} -g {rg} -o table`
- CORS origins match: API env var `ALLOWED_ORIGINS` must include the web container URL
- Internal DNS: Web nginx proxies to `http://ca-api-{env}-{suffix}.internal.{domain}`

---

## Copilot Extensibility Skills Reference

The SRE Agent should have the following skills available for investigating and resolving issues:

### azure-kusto
**Purpose**: Run KQL queries against Log Analytics to investigate logs, metrics, and traces.
**When to use**: Any time you need to query `AppRequests`, `AppTraces`, `AppExceptions`, `AppMetrics`, or `AppPerformanceCounters`.
**Workspace ID**: Retrieve via `az monitor log-analytics workspace show --name law-{env}-{suffix} -g {rg} --query customerId -o tsv`.

### azure-observability
**Purpose**: Azure Monitor, Application Insights, Log Analytics, Alerts, and Workbooks operations.
**When to use**: Setting up or modifying alerts, checking Application Insights configuration, creating workbooks for dashboards.

### azure-diagnostics
**Purpose**: Debug production issues on Azure Container Apps — log analysis, health checks, image pull failures, cold starts.
**When to use**: Container app is unhealthy, pods not starting, revision deployment failures.

### azure-resource-lookup
**Purpose**: List and find Azure resources across subscriptions.
**When to use**: Finding resource names, verifying resources exist, checking tags, discovering resource group contents.

### azure-appservice / azure-compute
**Purpose**: Manage container apps and compute resources.
**When to use**: Checking container app status, revision management, scaling configuration.

### azure-keyvault
**Purpose**: Manage Key Vault secrets.
**When to use**: Verifying `GITHUB_TOKEN` secret exists and is accessible by the managed identity.

### azure-resource-visualizer
**Purpose**: Generate architecture diagrams from resource groups.
**When to use**: Visualizing the deployed architecture and resource relationships for incident context.

---

## Environment Details

| Property | Value |
|---|---|
| **Resource Group** | `rg-copilot-sdk-app` |
| **Log Analytics Workspace** | `law-copilot-sdk-app-gic2lx` |
| **Workspace ID** | `17ed1fc7-ed8f-4cae-87fd-9cc58eea1a89` |
| **Region** | `eastus2` |
| **API Container** | `ca-api-copilot-sdk-app-gic2lx` (internal, port 3000) |
| **Web Container** | `ca-web-copilot-sdk-app-gic2lx` (external, port 80) |
| **Container Registry** | `acrcopilotsdkappgic2lx` |
| **Key Vault** | `kv-csa-gic2lx` |
| **Telemetry SDK** | `@azure/monitor-opentelemetry` 1.16.0 + `@opentelemetry/api` 1.9.0 |
| **Runtime** | Node.js 24 on Alpine Linux |
