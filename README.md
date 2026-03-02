---
page_type: sample
languages:
  - azdeveloper
  - nodejs
  - typescript
  - bicep
  - html
  - css
products:
  - azure
  - azure-container-apps
  - azure-container-registry
  - azure-key-vault
  - azure-monitor
  - ai-services
  - github
urlFragment: copilot-sdk-service
name: Copilot SDK Service — Chat API with React UI on Azure Container Apps
description: A full-stack TypeScript template using the GitHub Copilot SDK with SSE streaming chat and one-shot summarize endpoints, deployed to Azure Container Apps via azd.
---
<!-- YAML front-matter schema: https://review.learn.microsoft.com/en-us/help/contribute/samples/process/onboarding?branch=main#supported-metadata-fields-for-readmemd -->

# Copilot SDK Service — Chat API with React UI on Azure Container Apps

[![Open in GitHub Codespaces](https://img.shields.io/static/v1?style=for-the-badge&label=GitHub+Codespaces&message=Open&color=brightgreen&logo=github)](https://codespaces.new/azure-samples/copilot-sdk-service)
[![Open in Dev Container](https://img.shields.io/static/v1?style=for-the-badge&label=Dev+Containers&message=Open&color=blue&logo=visualstudiocode)](https://vscode.dev/redirect?url=vscode://ms-vscode-remote.remote-containers/cloneInVolume?url=https://github.com/azure-samples/copilot-sdk-service)

A starter template for building AI-powered API services with the [GitHub Copilot SDK](https://github.com/github/copilot-sdk) deployed to [Azure Container Apps](https://learn.microsoft.com/azure/container-apps/). It includes a chat endpoint with SSE streaming and a one-shot summarize endpoint, with a React chat UI for testing.

Add your own source code and leverage the Infrastructure as Code assets (written in Bicep) to get up and running quickly. The template supports three model paths: GitHub default, GitHub specific model, or Azure Bring Your Own Model (BYOM) with `DefaultAzureCredential`.

### Prerequisites

The following prerequisites are required to use this application. Please ensure that you have them all installed locally.

| Tool | Version | Purpose |
|------|---------|---------|
| [Azure Developer CLI (`azd`)](https://aka.ms/azd-install) | Latest | Provisions and deploys Azure resources |
| [Node.js](https://nodejs.org/) | 24+ | Runtime for the API and build tooling |
| [pnpm](https://pnpm.io/) | 10+ | Fast, disk-efficient package manager |
| [GitHub CLI (`gh`)](https://cli.github.com/) | Latest | Provides the `GITHUB_TOKEN` for the Copilot SDK |
| [Docker](https://docs.docker.com/get-docker/) | Latest | Required for Azure deployment (container builds) |

**GitHub CLI setup:**

```bash
gh auth login
gh auth refresh --scopes copilot
```

### Quickstart

To learn how to get started with any template, follow the steps in [this quickstart](https://learn.microsoft.com/azure/developer/azure-developer-cli/get-started?tabs=localinstall&pivots=programming-language-nodejs) with this template (`Azure-Samples/copilot-sdk-service`).

This quickstart will show you how to authenticate on Azure, initialize using a template, provision infrastructure and deploy code on Azure via the following commands:

```bash
# Log in to azd. Only required once per-install.
azd auth login

# First-time project setup. Initialize a project in the current directory, using this template.
azd init --template Azure-Samples/copilot-sdk-service

# Provision and deploy to Azure
azd up
```

### Application Architecture

This application utilizes the following Azure resources:

- [**Azure Container Apps**](https://docs.microsoft.com/azure/container-apps/) to host the API backend and web frontend
- [**Azure Container Registry**](https://docs.microsoft.com/azure/container-registry/) for Docker image storage
- [**Azure Key Vault**](https://docs.microsoft.com/azure/key-vault/) for securing the `GITHUB_TOKEN`
- [**Azure Monitor**](https://docs.microsoft.com/azure/azure-monitor/) for monitoring and logging
- [**Azure OpenAI**](https://docs.microsoft.com/azure/ai-services/openai/) *(optional)* for Bring Your Own Model (BYOM)

Here's a high level architecture diagram that illustrates these components. Notice that these are all contained within a single [resource group](https://docs.microsoft.com/azure/azure-resource-manager/management/manage-resource-groups-portal), that will be created for you when you create the resources.

> This template provisions resources to an Azure subscription that you will select upon provisioning them. Please refer to the [Pricing calculator for Microsoft Azure](https://azure.microsoft.com/pricing/calculator/) and, if needed, update the included Azure resource definitions found in `infra/main.bicep` to suit your needs.

### Application Code

The template is structured to follow the [Azure Developer CLI](https://aka.ms/azure-dev/overview) conventions. You can learn more about `azd` architecture in [the official documentation](https://learn.microsoft.com/azure/developer/azure-developer-cli/make-azd-compatible?pivots=azd-create#understand-the-azd-architecture).

- **Backend** (`src/api/`) — Express server with chat (SSE streaming) and summarize (one-shot) endpoints via `@github/copilot-sdk`.
- **Frontend** (`src/web/`) — React + Vite chat UI with SSE streaming, dark/light mode, and Markdown rendering.

## How It Works (Copilot SDK)

This template supports three model paths:

### GitHub Default (no config)
```typescript
const session = await client.createSession({});
const result = await session.sendAndWait({ prompt: "Hello" });
```

### GitHub Specific Model
```typescript
const session = await client.createSession({ model: "gpt-4o" });
```

### Azure BYOM (Bring Your Own Model)
```typescript
import { DefaultAzureCredential } from "@azure/identity";
const credential = new DefaultAzureCredential();
const { token } = await credential.getToken("https://cognitiveservices.azure.com/.default");

const session = await client.createSession({
  model: process.env.MODEL_NAME,
  provider: {
    type: "azure",
    baseUrl: process.env.AZURE_OPENAI_ENDPOINT,
    bearerToken: token,
  },
});
```

Configure via environment variables: `MODEL_PROVIDER`, `MODEL_NAME`, `AZURE_OPENAI_ENDPOINT`. See `src/api/model-config.ts`.

### Testing Each Model Path

All three paths can be tested locally. Set the environment variables before running the service.

You can run with either [`azd app run`](https://github.com/jongio/azd-app) (starts both API and web UI) or `pnpm dev` (API only):

**1. GitHub Default (no config needed)**

No environment variables required — the SDK picks its default model:

```bash
# Option A: azd app run (recommended — starts API + web UI, auto-installs deps)
azd app run

# Option B: manual
export GITHUB_TOKEN=$(gh auth token)
cd src/api && pnpm dev
```

**2. GitHub Specific Model**

Set `MODEL_NAME` to choose a specific GitHub-hosted model:

```bash
# Option A: azd app run
azd env set MODEL_NAME gpt-4o
azd app run

# Option B: manual
export GITHUB_TOKEN=$(gh auth token)
export MODEL_NAME=gpt-4o
cd src/api && pnpm dev
```

**3. Azure BYOM (Bring Your Own Model)**

Set `MODEL_PROVIDER=azure` along with your Azure OpenAI endpoint and deployment name. Authentication uses `DefaultAzureCredential`, so make sure you're logged in with `az login`:

```bash
# Option A: azd app run
az login
azd env set MODEL_PROVIDER azure
azd env set MODEL_NAME <your-deployment-name>
azd env set AZURE_OPENAI_ENDPOINT https://<your-resource>.openai.azure.com
azd app run

# Option B: manual
export GITHUB_TOKEN=$(gh auth token)
export MODEL_PROVIDER=azure
export MODEL_NAME=<your-deployment-name>
export AZURE_OPENAI_ENDPOINT=https://<your-resource>.openai.azure.com
az login
cd src/api && pnpm dev
```

**Verify any path with:**

```bash
curl -X POST http://localhost:3100/chat \
  -H "Content-Type: application/json" \
  -d '{"message": "Hello"}'
```

### Local Development

The easiest way to run locally is with [`azd app`](https://github.com/jongio/azd-app), which starts all services, installs dependencies, and provides a real-time dashboard:

```bash
# Install the azd app extension (one-time)
azd extension source add -n jongio -t url -l https://jongio.github.io/azd-extensions/registry.json
azd extension install jongio.azd.app

# Run locally
azd app run
```

The `prerun` hook automatically retrieves your `GITHUB_TOKEN` from the `gh` CLI via `scripts/get-github-token.mjs`. Open the URL shown in the dashboard output to start testing.

<details>
<summary><b>Run services manually (without azd app)</b></summary>

```bash
# Set your GitHub token
export GITHUB_TOKEN=$(gh auth token)

# Install dependencies
cd src/api && pnpm install && cd ../web && pnpm install && cd ../..

# Start the API server (in one terminal)
cd src/api && pnpm dev

# Start the web dev server (in another terminal)
cd src/web && pnpm dev
```

</details>

| Command | Directory | Description |
|---------|-----------|-------------|
| `azd app run` | repo root | Start all services with auto-dependency install and dashboard |
| `pnpm dev` | `src/api` | Start the Express server with hot reload (via `tsx --watch`) |
| `pnpm dev` | `src/web` | Start the Vite dev server with HMR for the React frontend |
| `pnpm build` | `src/api` | Compile the Express server |
| `pnpm build` | `src/web` | Bundle the React frontend |

## Adding Endpoints

Endpoints are Express routes that use the Copilot SDK for one-shot AI processing. To add a new endpoint:

**1. Create a route file in `src/api/routes/`:**

```typescript
// src/api/routes/classify.ts
import { Router } from "express";
import { CopilotClient } from "@github/copilot-sdk";

const router = Router();

router.post("/classify", async (req, res) => {
  const client = new CopilotClient({ githubToken: process.env.GITHUB_TOKEN });
  const { getSessionOptions } = await import("../model-config.js");
  const options = await getSessionOptions();
  const session = await client.createSession(options);
  const result = await session.sendAndWait({
    prompt: `Classify the following text into a category:\n\n${req.body.text}`,
  });
  res.json({ category: result?.data?.content });
});

export default router;
```

**2. Register the route in `src/api/index.ts`:**

```typescript
import classifyRoutes from "./routes/classify.js";

app.use(classifyRoutes);
```

**3. Add a proxy rule in `src/web/nginx.conf.template`** (for production):

```nginx
location /classify {
    proxy_pass ${API_URL}/classify;
    proxy_http_version 1.1;
    proxy_set_header Host $proxy_host;
}
```

## Testing

### Integration Tests

Integration tests live in `tests/integration/` and use **Vitest** to verify all 3 model configuration paths:

```bash
# Run from the integration test directory
cd tests/integration && pnpm install && pnpm test

# Or from src/api
cd src/api && pnpm test:models
```

**What it tests:**
- ✅ GitHub Default model (no config)
- ✅ GitHub Specific model (`MODEL_NAME=gpt-4o`)
- ✅ Azure BYOM (auto-skipped if not configured)

**Prerequisites:**
- `GITHUB_TOKEN` — required for all tests (auto-resolved from `gh auth token` if not set)
- `AZURE_MODEL_NAME` and `AZURE_OPENAI_ENDPOINT` — optional, for Azure BYOM tests

**Local usage:** When running locally without Azure env vars, an interactive prompt offers to load values from `azd` environments or run `azd up`. To skip Azure tests, just don't set the Azure env vars.

**CI usage:** Set env vars (`GITHUB_TOKEN`, `AZURE_OPENAI_ENDPOINT`, `AZURE_MODEL_NAME`, `CI=true`) and run — no interactive prompts.

See [`scripts/README.md`](scripts/README.md) for detailed setup instructions.

## Deploy to Azure

```bash
azd up
```

This single command handles the entire deployment pipeline:

1. **Preprovision hook** — Retrieves your `GITHUB_TOKEN` from the `gh` CLI and stores it in the `azd` environment
2. **Provisions infrastructure** — Creates Azure Container Registry, Container Apps Environment, Key Vault, Application Insights, and a managed identity (using [Azure Verified Modules](https://azure.github.io/Azure-Verified-Modules/))
3. **Builds and pushes** — Builds the Docker images and pushes them to the provisioned ACR
4. **Deploys** — Deploys both containers to Azure Container Apps with the `GITHUB_TOKEN` securely referenced from Key Vault

### Verify Deployed App

After deploying, verify the live app:

```bash
export AZURE_CONTAINER_APP_WEB_URL=$(azd env get-value AZURE_CONTAINER_APP_WEB_URL)
cd src/api && pnpm test:deployed
```

### Next Steps

At this point, you have a complete application deployed on Azure. But there is much more that the Azure Developer CLI can do. These next steps will introduce you to additional commands that will make creating applications on Azure much easier. Using the Azure Developer CLI, you can setup your pipelines, monitor your application, test and debug locally.

> Note: Needs to manually install [setup-azd extension](https://marketplace.visualstudio.com/items?itemName=ms-azuretools.azd) for Azure DevOps (azdo).

- [`azd pipeline config`](https://learn.microsoft.com/azure/developer/azure-developer-cli/configure-devops-pipeline?tabs=GitHub) - to configure a CI/CD pipeline (using GitHub Actions or Azure DevOps) to deploy your application whenever code is pushed to the main branch.

- [`azd monitor`](https://learn.microsoft.com/azure/developer/azure-developer-cli/monitor-your-app) - to monitor the application and quickly navigate to the various Application Insights dashboards (e.g. overview, live metrics, logs)

- [Run and Debug Locally](https://learn.microsoft.com/azure/developer/azure-developer-cli/debug?pivots=ide-vs-code) - using Visual Studio Code and the Azure Developer CLI extension

- [`azd down`](https://learn.microsoft.com/azure/developer/azure-developer-cli/reference#azd-down) - to delete all the Azure resources created with this template

## Security

### Roles

This template creates a [managed identity](https://docs.microsoft.com/azure/active-directory/managed-identities-azure-resources/overview) for your app inside your Azure Active Directory tenant, and it is used to authenticate your app with Azure and other services that support Azure AD authentication like Key Vault via access policies. You will see principalId referenced in the infrastructure as code files, that refers to the id of the currently logged in Azure Developer CLI user, which will be granted access policies and permissions to run the application locally. To view your managed identity in the Azure Portal, follow these [steps](https://docs.microsoft.com/azure/active-directory/managed-identities-azure-resources/how-to-view-managed-identity-service-principal-portal).

### Key Vault

This template uses [Azure Key Vault](https://docs.microsoft.com/azure/key-vault/general/overview) to securely store your `GITHUB_TOKEN` for the provisioned Copilot SDK service. Key Vault is a cloud service for securely storing and accessing secrets (API keys, passwords, certificates, cryptographic keys) and makes it simple to give other Azure services access to them. As you continue developing your solution, you may add as many secrets to your Key Vault as you require.

## Reporting Issues and Feedback

If you have any feature requests, issues, or areas for improvement, please [file an issue](https://aka.ms/azure-dev/issues). To keep up-to-date, ask questions, or share suggestions, join our [GitHub Discussions](https://aka.ms/azure-dev/discussions). You may also contact us via AzDevTeam@microsoft.com.
