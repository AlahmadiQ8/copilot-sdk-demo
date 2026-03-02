// Cache the credential and token. Tokens are valid ~1 hour; refresh 5 min before expiry.
let cachedCredential: { getToken(scope: string): Promise<{ token: string; expiresOnTimestamp: number }> } | null = null;
let cachedToken: { token: string; expiresOn: number } | null = null;

const TOKEN_REFRESH_BUFFER_MS = 5 * 60 * 1000;

/**
 * Models known to support the Copilot SDK's encrypted content format.
 * The SDK encrypts prompts before sending — only these model families can decrypt them.
 */
const SUPPORTED_MODEL_PREFIXES = [
  "o3", "o4-mini", "gpt-5", "codex-mini",
];

export function isModelSupported(modelName: string): boolean {
  const lower = modelName.toLowerCase();
  return SUPPORTED_MODEL_PREFIXES.some((p) => lower === p || lower.startsWith(p + "-") || lower.startsWith(p + "."));
}

export const UNSUPPORTED_MODEL_MESSAGE =
  `The configured model does not support the Copilot SDK's encrypted content format. ` +
  `Only o-series (o3, o3-mini, o4-mini) and gpt-5 family models are supported. ` +
  `Current model: "${process.env.MODEL_NAME ?? "(default)"}". ` +
  `Change MODEL_NAME to a supported model (e.g., o4-mini) or update the Azure OpenAI deployment.`;

/**
 * Detect the "Encrypted content is not supported" error from Azure OpenAI
 * and replace with a helpful message.
 */
export function enhanceModelError(err: unknown): Error {
  const msg = err instanceof Error ? err.message : String(err);
  if (msg.includes("Encrypted content is not supported")) {
    return new Error(
      `Model "${process.env.MODEL_NAME ?? "(unknown)"}" does not support encrypted content. ` +
      `The Copilot SDK encrypts prompts, so only o-series (o3, o3-mini, o4-mini) and gpt-5 family models work. ` +
      `Change MODEL_NAME to a supported model (e.g., o4-mini) and update your Azure OpenAI deployment.`
    );
  }
  return err instanceof Error ? err : new Error(msg);
}

async function getAzureBearerToken(): Promise<string> {
  if (cachedToken && Date.now() < cachedToken.expiresOn - TOKEN_REFRESH_BUFFER_MS) {
    return cachedToken.token;
  }
  if (!cachedCredential) {
    const { DefaultAzureCredential } = await import("@azure/identity");
    cachedCredential = new DefaultAzureCredential();
  }
  const result = await cachedCredential.getToken("https://cognitiveservices.azure.com/.default");
  if (!result) {
    throw new Error(
      "Failed to acquire Azure bearer token. " +
      "Ensure the app has a managed identity with 'Cognitive Services OpenAI User' role, " +
      "or that local credentials (az login / AZURE_CLIENT_ID) are configured."
    );
  }
  cachedToken = { token: result.token, expiresOn: result.expiresOnTimestamp };
  return result.token;
}

/**
 * Build session options for createSession().
 *
 * Three paths:
 *   1. No env vars          → GitHub default model
 *   2. MODEL_NAME only      → GitHub specific model
 *   3. MODEL_PROVIDER=azure → Azure BYOM via SDK with bearerToken (RBAC)
 */
export async function getSessionOptions(opts?: { streaming?: boolean }): Promise<Record<string, unknown>> {
  const provider = process.env.MODEL_PROVIDER;
  const modelName = process.env.MODEL_NAME;
  const streaming = opts?.streaming ?? false;

  // Path 3: Azure BYOM — use SDK with type "azure" + bearerToken for RBAC auth
  if (provider === "azure") {
    const endpoint = process.env.AZURE_OPENAI_ENDPOINT;
    if (!endpoint || !modelName) {
      throw new Error("AZURE_OPENAI_ENDPOINT and MODEL_NAME are required when MODEL_PROVIDER is 'azure'");
    }
    if (!isModelSupported(modelName)) {
      console.warn(
        `⚠️  Warning: MODEL_NAME="${modelName}" may not support encrypted content. ` +
        `The Copilot SDK requires o-series (o3, o3-mini, o4-mini) or gpt-5 family models.`
      );
    }
    const bearerToken = await getAzureBearerToken();
    return {
      model: modelName,
      streaming,
      provider: {
        type: "azure",
        baseUrl: endpoint.replace(/\/$/, ""),
        bearerToken,
        wireApi: "responses",
        azure: { apiVersion: "2025-04-01-preview" },
      },
    };
  }

  // Path 1: GitHub default — no model, no provider
  if (!modelName) {
    return { streaming };
  }

  // Path 2: GitHub specific — model only, no provider
  return { model: modelName, streaming };
}
