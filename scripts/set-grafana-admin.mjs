#!/usr/bin/env node
/**
 * Pre-provision hook: reads the signed-in user's object ID and sets
 * AZURE_GRAFANA_ADMIN_PRINCIPAL_ID so the deploying user gets Grafana Admin access.
 *
 * Silently skips if running as a service principal (e.g. CI/CD), so the
 * grafanaAdminPrincipalId param stays empty and no role assignment is created.
 */
import { execSync } from "child_process";

try {
  const principalId = execSync("az ad signed-in-user show --query id -o tsv", {
    stdio: ["pipe", "pipe", "pipe"],
  })
    .toString()
    .trim();

  if (principalId) {
    execSync(`azd env set AZURE_GRAFANA_ADMIN_PRINCIPAL_ID "${principalId}"`, {
      stdio: "inherit",
    });
    console.log(`✓ AZURE_GRAFANA_ADMIN_PRINCIPAL_ID set to ${principalId}`);
  }
} catch {
  // Service principal deployment or user not signed in — skip gracefully
  console.log(
    "Skipping Grafana admin role (not signed in as a user — set AZURE_GRAFANA_ADMIN_PRINCIPAL_ID manually if needed)"
  );
}
