import { spawn } from "node:child_process";
import {
  normalizeCapabilities,
  type CapabilitySelection,
} from "./capabilities.js";

export function frontendRegistryItem(
  selection: CapabilitySelection,
): string | undefined {
  const capabilities = normalizeCapabilities(selection);
  return !capabilities.frontend
    ? undefined
    : capabilities.realtime
      ? "gasboost/ui/frontend-auth-realtime"
      : capabilities.authentication
        ? "gasboost/ui/frontend-auth"
        : "gasboost/ui/frontend";
}

export async function installFrontend({
  targetDirectory,
  capabilities,
}: {
  targetDirectory: string;
  capabilities: CapabilitySelection;
}): Promise<void> {
  const item = frontendRegistryItem(capabilities);
  if (!item) return;
  await new Promise<void>((resolve, reject) => {
    const command = process.platform === "win32" ? "pnpm.cmd" : "pnpm";
    const child = spawn(
      command,
      ["dlx", "shadcn@latest", "add", item, "--yes"],
      {
        cwd: targetDirectory,
        detached: process.platform !== "win32",
        stdio: "inherit",
        shell: process.platform === "win32",
      },
    );
    const timer = setTimeout(() => {
      try {
        if (process.platform !== "win32" && child.pid !== undefined)
          process.kill(-child.pid, "SIGTERM");
        else child.kill("SIGTERM");
      } catch {
        child.kill("SIGTERM");
      }
    }, 180_000);
    child.once("error", (error) => {
      clearTimeout(timer);
      reject(error);
    });
    child.once("close", (code) => {
      clearTimeout(timer);
      if (code === 0) resolve();
      else
        reject(
          new Error(
            `Frontend installation failed (${String(code)}). Retry in ${targetDirectory}: pnpm dlx shadcn@latest add ${item} --yes`,
          ),
        );
    });
  });
}
