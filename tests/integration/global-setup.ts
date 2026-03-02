/**
 * Vitest globalSetup — resolves environment variables once before all test files run.
 *
 * - GITHUB_TOKEN: required for all tests (resolved from env or `gh auth token`)
 * - AZURE_OPENAI_ENDPOINT / AZURE_MODEL_NAME: auto-loaded from the default azd
 *   environment. Falls back to interactive prompt only when auto-load fails and
 *   a TTY is available.
 */

import { execSync, spawn } from "child_process";
import { createInterface } from "readline/promises";

// ── CLI prerequisite checks ──────────────────────────────────────────

interface CliStatus {
  gh: boolean;
  az: boolean;
  azd: boolean;
}

function checkCli(
  name: string,
  versionCmd: string,
  authCheckCmd: string,
  loginHint: string,
): boolean {
  try {
    execSync(versionCmd, { stdio: "ignore" });
  } catch {
    console.log(`❌ ${name} is not installed.`);
    return false;
  }

  try {
    execSync(authCheckCmd, {
      encoding: "utf-8",
      stdio: ["ignore", "pipe", "ignore"],
    });
  } catch {
    console.log(`❌ ${name} is not authenticated. Run: ${loginHint}`);
    return false;
  }

  console.log(`  ✓ ${name}`);
  return true;
}

function checkPrerequisites(): CliStatus {
  console.log("\nChecking CLI prerequisites...");
  const gh = checkCli("GitHub CLI (gh)", "gh --version", "gh auth status", "gh auth login");
  const az = checkCli("Azure CLI (az)", "az --version", "az account show", "az login");
  const azd = checkCli("Azure Developer CLI (azd)", "azd version", "azd auth login --check-status", "azd auth login");
  return { gh, az, azd };
}

// ── GITHUB_TOKEN resolution ──────────────────────────────────────────

function resolveGitHubToken(): void {
  if (process.env.GITHUB_TOKEN) {
    console.log("  ✓ GITHUB_TOKEN already set");
    return;
  }

  try {
    const token = execSync("gh auth token", {
      encoding: "utf-8",
      stdio: ["ignore", "pipe", "ignore"],
    }).trim();
    if (token) {
      process.env.GITHUB_TOKEN = token;
      console.log("  ✓ GITHUB_TOKEN resolved from gh CLI");
      return;
    }
  } catch {
    // gh not installed or not authenticated
  }

  console.error("❌ GITHUB_TOKEN could not be resolved.");
  console.error("   Set GITHUB_TOKEN or run: gh auth login");
  throw new Error("GITHUB_TOKEN is required to run integration tests");
}

// ── azd environment helpers ──────────────────────────────────────────

interface AzdEnv {
  Name: string;
  IsDefault: boolean;
}

function listAzdEnvs(): AzdEnv[] {
  try {
    const raw = execSync("azd env list --output json", {
      encoding: "utf-8",
      stdio: ["ignore", "pipe", "ignore"],
    });
    return JSON.parse(raw) as AzdEnv[];
  } catch {
    return [];
  }
}

function getAzdEnvValue(envName: string, key: string): string | undefined {
  try {
    return execSync(`azd env get-value ${key} -e "${envName}"`, {
      encoding: "utf-8",
      stdio: ["ignore", "pipe", "ignore"],
    }).trim() || undefined;
  } catch {
    return undefined;
  }
}

function refreshAzdEnv(envName: string): void {
  console.log("  ↻ Refreshing outputs from last deployment...");
  try {
    execSync(`azd env refresh -e "${envName}" --no-prompt`, {
      stdio: "ignore",
      timeout: 30_000,
    });
  } catch {
    // best-effort refresh
  }
}

function loadAzdEnvVars(envName: string): void {
  console.log(`\nLoading Azure vars from azd environment: ${envName}`);

  let endpoint = getAzdEnvValue(envName, "AZURE_OPENAI_ENDPOINT");
  let modelName = getAzdEnvValue(envName, "AZURE_MODEL_NAME");

  // If key values are missing, refresh outputs from the last deployment and retry
  if (!endpoint || !modelName) {
    refreshAzdEnv(envName);
    endpoint = endpoint || getAzdEnvValue(envName, "AZURE_OPENAI_ENDPOINT");
    modelName = modelName || getAzdEnvValue(envName, "AZURE_MODEL_NAME");
  }

  if (endpoint) {
    process.env.AZURE_OPENAI_ENDPOINT = endpoint;
    console.log(`  ✓ AZURE_OPENAI_ENDPOINT = ${endpoint}`);
  }

  modelName = modelName || "gpt-4o";
  process.env.AZURE_MODEL_NAME = modelName;
  console.log(`  ✓ AZURE_MODEL_NAME = ${modelName}`);
}

// ── Interactive prompt helpers ───────────────────────────────────────

async function promptChoice(question: string, choices: string[], timeoutMs = 15_000): Promise<number> {
  const rl = createInterface({ input: process.stdin, output: process.stdout });
  try {
    console.log("");
    for (let i = 0; i < choices.length; i++) {
      console.log(`  ${i + 1}) ${choices[i]}`);
    }
    console.log("");
    const answer = await Promise.race([
      rl.question(question),
      new Promise<string>((resolve) =>
        setTimeout(() => {
          console.log(`\n  ⏱ No input received after ${timeoutMs / 1000}s — skipping.`);
          resolve("");
        }, timeoutMs),
      ),
    ]);
    const idx = parseInt(answer.trim(), 10) - 1;
    return idx >= 0 && idx < choices.length ? idx : -1;
  } finally {
    rl.close();
  }
}

function runInteractive(command: string, args: string[]): Promise<boolean> {
  return new Promise((resolve) => {
    const child = spawn(command, args, { stdio: "inherit", shell: true });
    child.on("error", () => resolve(false));
    child.on("close", (code) => resolve(code === 0));
  });
}

async function runAzdUp(): Promise<void> {
  console.log("\nRunning azd up...\n");
  const ok = await runInteractive("azd", ["up"]);
  if (!ok) {
    console.log("❌ azd up failed.");
    return;
  }
  const envs = listAzdEnvs();
  if (envs.length > 0) {
    const defaultEnv = envs.find((e) => e.IsDefault) || envs[0];
    loadAzdEnvVars(defaultEnv.Name);
  }
}

// ── Azure env resolution ─────────────────────────────────────────────

function isInteractive(): boolean {
  const ci = process.env.CI;
  if (ci === "true" || ci === "1") return false;

  if (!process.stdin.isTTY) return false;

  return true;
}

/**
 * Auto-load Azure vars from the default azd environment.
 * Returns true if AZURE_OPENAI_ENDPOINT was resolved.
 */
function tryAutoLoadAzdEnv(): boolean {
  if (process.env.AZURE_OPENAI_ENDPOINT) return true;

  const envs = listAzdEnvs();
  if (envs.length === 0) return false;

  const defaultEnv = envs.find((e) => e.IsDefault) || (envs.length === 1 ? envs[0] : undefined);
  if (!defaultEnv) return false;

  loadAzdEnvVars(defaultEnv.Name);
  return !!process.env.AZURE_OPENAI_ENDPOINT;
}

async function resolveAzureEnvInteractive(): Promise<void> {
  const envs = listAzdEnvs();

  const choices: string[] = envs.map(
    (e) => `${e.Name}${e.IsDefault ? " (default)" : ""}`,
  );
  choices.push("Run azd up (provision and deploy)");
  choices.push("Skip Azure tests");

  console.log("\n⚠️  Azure BYOM endpoint not found in the default azd environment.");
  console.log("Select an azd environment to load from:");
  const idx = await promptChoice("Choice: ", choices);

  if (idx >= 0 && idx < envs.length) {
    // User picked an existing environment
    loadAzdEnvVars(envs[idx].Name);

    // If the endpoint still wasn't found, offer to run azd up or skip
    if (!process.env.AZURE_OPENAI_ENDPOINT) {
      console.log("\n  ⚠️  AZURE_OPENAI_ENDPOINT not found in this environment.");
      console.log("  Azure OpenAI may not have been provisioned yet.");

      const fallbackIdx = await promptChoice("What would you like to do? ", [
        "Run azd up (provision and deploy)",
        "Skip Azure tests",
      ]);

      if (fallbackIdx === 0) {
        await runAzdUp();
      }
    }
  } else if (idx === envs.length) {
    // "Run azd up"
    await runAzdUp();
  }
  // else: skip — Azure tests will be skipped via describe.skipIf
}

// ── Main setup entry point ───────────────────────────────────────────

export async function setup(): Promise<void> {
  console.log("\n╔════════════════════════════════════════════════════════════╗");
  console.log("║     Integration Test Environment Setup                    ║");
  console.log("╚════════════════════════════════════════════════════════════╝");

  // 1. Check CLI prerequisites
  const cli = checkPrerequisites();

  // 2. Resolve GITHUB_TOKEN (required — throws on failure)
  resolveGitHubToken();

  // 3. Resolve Azure environment: auto-load from default azd env, prompt only as fallback
  if (cli.azd && !process.env.AZURE_OPENAI_ENDPOINT) {
    const loaded = tryAutoLoadAzdEnv();
    if (!loaded && isInteractive()) {
      await resolveAzureEnvInteractive();
    }
  }

  // 4. Log final environment state
  const hasAzure = !!(process.env.AZURE_OPENAI_ENDPOINT && process.env.AZURE_MODEL_NAME);
  console.log("\nEnvironment summary:");
  console.log(`  GITHUB_TOKEN:          ${process.env.GITHUB_TOKEN ? "set" : "MISSING"}`);
  console.log(`  AZURE_OPENAI_ENDPOINT: ${process.env.AZURE_OPENAI_ENDPOINT || "(not set — Azure tests will be skipped)"}`);
  console.log(`  AZURE_MODEL_NAME:      ${process.env.AZURE_MODEL_NAME || "(not set)"}`);
  console.log(`  CI:                    ${process.env.CI || "(not set)"}`);
  console.log(`  Azure BYOM tests:      ${hasAzure ? "ENABLED" : "SKIPPED"}`);
  console.log("");
}
