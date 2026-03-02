import { CopilotClient } from "@github/copilot-sdk";

let client: CopilotClient | null = null;

/** Shared CopilotClient singleton — one CLI subprocess for the entire server. */
export async function getClient(): Promise<CopilotClient> {
  if (!client) {
    client = new CopilotClient({
      githubToken: process.env.GITHUB_TOKEN,
    });
  }
  return client;
}
