import { execSync } from "node:child_process";

// Set Cosmos DB environment variables from azd env for local development.
// These are populated by `azd provision` from the Bicep outputs.

const vars = [
  { env: "COSMOS_ENDPOINT", azd: "AZURE_COSMOS_ENDPOINT" },
  { env: "COSMOS_DATABASE", azd: "COSMOS_DATABASE", fallback: "conversations" },
];

for (const { env, azd, fallback } of vars) {
  if (process.env[env]) continue; // already set

  let value = "";
  try {
    value = execSync(`azd env get-value ${azd}`, {
      encoding: "utf-8",
      stdio: ["ignore", "pipe", "ignore"],
    }).trim();
  } catch {
    // not set in azd env
  }

  if (!value && fallback) value = fallback;

  if (value) {
    console.log(`✓ ${env} set from azd environment.`);
    // Export for the current process tree (azd app run will forward this)
    process.env[env] = value;

    // Also persist to azd env so child services pick it up
    const isWindows = process.platform === "win32";
    const cmd = isWindows
      ? `azd env set ${env} %__VAL%`
      : `azd env set ${env} "$__VAL"`;
    try {
      execSync(cmd, {
        env: { ...process.env, __VAL: value },
        stdio: "inherit",
        shell: true,
      });
    } catch {
      // Best effort — may fail if azd env is not initialized
    }
  } else {
    console.log(`ℹ️  ${env} not set — conversation store will be unavailable locally.`);
  }
}
