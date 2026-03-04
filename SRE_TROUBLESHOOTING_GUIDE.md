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
| **Key Vault** | `kv-{shortname}-{suffix}` | Stores `COPILOT_GITHUB_TOKEN` secret |
| **Managed Identity** | `id-{env}-{suffix}` | RBAC access to Key Vault, Cosmos DB, and optional Azure OpenAI |
| **Cosmos DB (NoSQL)** | `cosmos-{env}-{suffix}` | Conversation store — `messages` container, partition key `/conversationId`, 24h TTL |
| **Azure OpenAI** *(optional)* | `oai-{env}-{suffix}` | BYOM endpoint (only when `useAzureModel=true`) |

### Request Flow

```
User → Web (nginx :80) → API (Express :3000) → Copilot SDK → GitHub/Azure OpenAI
                                                 ↕
                                           Cosmos DB (conversation store)
```

The web container proxies `/chat`, `/summarize`, `/health`, `/config`, and `/conversations` to the internal API container.

### API Endpoints

| Endpoint | Method | Description |
|---|---|---|
| `/chat` | POST | Multi-turn chat with SSE streaming. Body: `{ message, history? }` |
| `/summarize` | POST | One-shot text summarization. Body: `{ text }` |
| `/health` | GET | Health check — returns `{ status, uptime, telemetry, store }` |
| `/config` | GET | Model configuration — returns `{ model, provider }` |
| `/conversations` | POST | Create a new conversation. Body: `{ title? }` |
| `/conversations` | GET | List conversations. Query: `limit`, `offset` |
| `/conversations/:id` | GET | Get a conversation with full message history |
| `/conversations/:id` | DELETE | Delete a conversation |
| `/conversations/:id/messages` | POST | Send a message and stream AI response (SSE). Body: `{ message }` |

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

- **Counters**: `chat_requests_total`, `chat_errors_total`, `summarize_requests_total`, `summarize_errors_total`, `conversations_created_total`, `conversations_deleted_total`, `conversation_messages_total`, `cosmos_errors_total`
- **Histograms**: `chat_duration_ms`, `summarize_duration_ms`, `cosmos_duration_ms`
- **Structured logs**: Emitted via OpenTelemetry Logs API with attributes `{ route, model, provider, durationMs, error, conversationId }`

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
| `conversationId` | string | Conversation UUID (conversation endpoints only) |
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

### Cosmos DB Health

```kql
// Cosmos DB operation errors over time
AppMetrics
| where TimeGenerated > ago(1h)
| where Name == "cosmos_errors_total"
| summarize sum(Sum) by bin(TimeGenerated, 5m)
| render timechart
```

```kql
// Cosmos DB operation latency by operation type
AppMetrics
| where TimeGenerated > ago(1h)
| where Name == "cosmos_duration_ms"
| summarize avg(Sum) by tostring(Properties.operation), bin(TimeGenerated, 5m)
| render timechart
```

```kql
// Cosmos DB error log entries
AppTraces
| where TimeGenerated > ago(24h)
| where SeverityLevel >= 3
| where Message has_any ("Cosmos", "cosmos", "store", "conversation")
| project TimeGenerated, Message, Properties
| order by TimeGenerated desc
```

```kql
// Conversation lifecycle — creation and deletion rates
AppMetrics
| where TimeGenerated > ago(24h)
| where Name in ("conversations_created_total", "conversations_deleted_total", "conversation_messages_total")
| summarize sum(Sum) by Name, bin(TimeGenerated, 1h)
| render timechart
```

```kql
// Active conversations (created - deleted)
let created = AppMetrics
    | where TimeGenerated > ago(24h)
    | where Name == "conversations_created_total"
    | summarize created = sum(Sum);
let deleted = AppMetrics
    | where TimeGenerated > ago(24h)
    | where Name == "conversations_deleted_total"
    | summarize deleted = sum(Sum);
created
| join kind=fullouter deleted on $left.$left == $right.$right
| project active = coalesce(created, 0) - coalesce(deleted, 0)
```

```kql
// Conversation health check — failed vs successful message operations
AppTraces
| where TimeGenerated > ago(24h)
| where Message has_any ("Conversation message", "Failed to create", "Failed to list", "Failed to get")
| summarize
    success = countif(SeverityLevel < 3),
    failures = countif(SeverityLevel >= 3)
  by bin(TimeGenerated, 15m)
| render timechart
```

```kql
// Cosmos store initialization (first boot / container restart)
AppTraces
| where TimeGenerated > ago(24h)
| where Message == "Cosmos DB store initialized"
| project TimeGenerated, Properties
| order by TimeGenerated desc
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
- `COPILOT_GITHUB_TOKEN` expired or missing — check Key Vault secret
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

### 6. Conversations endpoint returns 500

**Symptom**: `POST /conversations` or `GET /conversations` returns HTTP 500.

**Check**:
```kql
AppTraces
| where TimeGenerated > ago(1h)
| where SeverityLevel >= 3
| where Message has_any ("conversation", "Cosmos", "store")
| project TimeGenerated, Message, Properties
| order by TimeGenerated desc
```

**Possible causes**:
- `COSMOS_ENDPOINT` env var not set — `/health` will show `store.configured: false`
- Managed identity missing `Cosmos DB Built-in Data Contributor` role on the Cosmos account
- Cosmos DB container `messages` not created — check if provisioning completed
- Network: Container App can't reach Cosmos endpoint (check VNet/firewall rules if applicable)

**Remediation**:
```bash
# Verify the env var is present on the container app
az containerapp show --name ca-api-{env}-{suffix} -g {rg} \
  --query "properties.template.containers[0].env[?name=='COSMOS_ENDPOINT']"

# Assign Cosmos DB Built-in Data Contributor to the managed identity
az cosmosdb sql role assignment create \
  --account-name {cosmos-account} \
  --resource-group {rg} \
  --role-definition-name "Cosmos DB Built-in Data Contributor" \
  --principal-id {managed-identity-principal-id} \
  --scope "/"
```

### 7. Cosmos DB latency spikes

**Symptom**: `cosmos_duration_ms` histogram shows p95 > 500ms.

**Check**:
```kql
AppMetrics
| where TimeGenerated > ago(6h)
| where Name == "cosmos_duration_ms"
| summarize
    p50 = percentile(Sum, 50),
    p95 = percentile(Sum, 95),
    p99 = percentile(Sum, 99)
  by tostring(Properties.operation), bin(TimeGenerated, 15m)
| render timechart
```

**Possible causes**:
- Cross-region latency — Cosmos account and Container Apps environment are in different regions
- RU/s throttling (429 responses) — check Cosmos metrics in Azure portal for Request Unit consumption
- Large conversation documents (many messages) slowing `read`/`update` operations
- Cold start — first operation after idle initializes the SDK client

**Remediation**: Check Cosmos DB "Insights" blade for throttled requests. Scale up RU/s or enable autoscale.

### 8. Conversation TTL not expiring

**Symptom**: Old conversations persist beyond 24 hours.

**Check**: Verify TTL is enabled on the `messages` container. Documents include `ttl: 86400` but TTL must also be enabled at the container level in Cosmos (set to `-1` for container-level default or a specific value).

```bash
az cosmosdb sql container show \
  --account-name {cosmos-account} \
  --database-name {COSMOS_DATABASE} \
  --name messages \
  --resource-group {rg} \
  --query "resource.defaultTtl"
```

If it returns `null`, TTL is not enabled. Enable it:
```bash
az cosmosdb sql container update \
  --account-name {cosmos-account} \
  --database-name {COSMOS_DATABASE} \
  --name messages \
  --resource-group {rg} \
  --ttl -1
```

---

## Copilot Agent Skills

The SRE Agent should have the following skills installed from [`microsoft/skills`](https://microsoft.github.io/skills/). Install skills with the Copilot CLI `/skills` command or by adding them to your project's skill configuration.

### Required Skills

#### azure-monitor-opentelemetry-ts *(already installed)*
**Source**: `microsoft/skills`
**Purpose**: Guidance for instrumenting Node.js apps with `@azure/monitor-opentelemetry` — tracing, metrics, logs, and Application Insights configuration.
**When to use**: Updating telemetry code, adding new custom metrics, troubleshooting SDK configuration.

#### azure-monitor-query-py
**Source**: `microsoft/skills`
**Purpose**: Query Log Analytics workspaces and Azure Monitor metrics using `LogsQueryClient` and `MetricsQueryClient`.
**When to use**: Running KQL queries against `AppRequests`, `AppTraces`, `AppExceptions`, `AppMetrics`, `AppPerformanceCounters`.

#### azure-monitor-ingestion-py
**Source**: `microsoft/skills`
**Purpose**: Send custom logs to Log Analytics via Data Collection Rules (DCR) and Logs Ingestion API.
**When to use**: Ingesting custom SRE dashboards data or external monitoring data into Log Analytics.

#### azure-identity-ts
**Source**: `microsoft/skills`
**Purpose**: Authentication patterns for Azure SDK clients — `DefaultAzureCredential`, managed identity, service principals.
**When to use**: Debugging auth failures, credential chain issues, managed identity configuration for Key Vault or Azure OpenAI access.

#### azure-keyvault-secrets-ts
**Source**: `microsoft/skills`
**Purpose**: Key Vault secrets management — store, retrieve, rotate secrets.
**When to use**: Verifying `COPILOT_GITHUB_TOKEN` secret exists and is accessible, debugging Key Vault access errors.

#### azure-cosmos-ts
**Source**: `microsoft/skills`
**Purpose**: Cosmos DB SDK patterns — `CosmosClient`, `DefaultAzureCredential` auth, container/item CRUD, partition keys, TTL, query execution, error handling.
**When to use**: Debugging Cosmos connection errors, optimizing queries, adding new fields to conversations, changing TTL or partition strategy.

### Recommended Skills

#### azure-monitor-opentelemetry-exporter-py
**Source**: `microsoft/skills`
**Purpose**: Low-level OpenTelemetry exporters for custom trace/metric/log pipelines to Application Insights.
**When to use**: Building custom export pipelines or advanced sampling configurations.

#### azure-mgmt-applicationinsights-dotnet
**Source**: `microsoft/skills`
**Purpose**: Application Insights resource management — components, web tests, workbooks.
**When to use**: Creating availability tests, configuring alert rules, managing App Insights resources programmatically.

### MCP Tools Reference

In addition to skills, the following MCP tools are available in the Copilot CLI for live Azure operations:

| Tool | Purpose |
|---|---|
| `azure-monitor` | Query Azure Monitor logs and metrics via KQL |
| `azure-appservice` | Manage Container Apps, web apps, configurations |
| `azure-keyvault` | Manage Key Vault secrets and access policies |
| `azure-cosmos` | Query Cosmos DB databases, containers, and documents |
| `azure-compute` | VM/VMSS management and monitoring |
| `azure-acr` | Container Registry operations |
| `azure-resourcehealth` | Check Azure resource availability status |
| `azure-applens` | AI-powered diagnostics for Azure resource issues |

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
| **Cosmos DB env var** | `COSMOS_ENDPOINT` — NoSQL account endpoint URL |
| **Cosmos DB name env var** | `COSMOS_DATABASE` — defaults to `conversations` |
| **Cosmos container** | `messages` — partition key `/conversationId`, TTL 86400s (24h) |
| **Telemetry SDK** | `@azure/monitor-opentelemetry` 1.16.0 + `@opentelemetry/api` 1.9.0 |
| **Runtime** | Node.js 24 on Alpine Linux |
