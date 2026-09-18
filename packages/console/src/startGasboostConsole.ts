import {
  startConsoleRuntime,
  type ConsoleRuntime,
} from "@gasboost/console-runtime";
import { fileURLToPath } from "node:url";
import { createAppsScriptOperations } from "./appsScript/appsScriptOperations.js";
import { createClaspRunner } from "./appsScript/ClaspRunner.js";
import type { ClaspRunner } from "./appsScript/ClaspRunner.js";
import { createProjectInspectOperation } from "./projectInspectOperation.js";

export async function startGasboostConsole({
  projectRoot,
  openBrowser = true,
  clasp = createClaspRunner(projectRoot),
}: {
  readonly projectRoot: string;
  readonly openBrowser?: boolean;
  readonly clasp?: ClaspRunner;
}): Promise<ConsoleRuntime> {
  const config = await loadGasboostConfig({ projectRoot });
  const appsScriptOperations =
    config.appsScript === undefined
      ? []
      : createAppsScriptOperations({
          projectRoot,
          config: config.appsScript,
          clasp,
        });

  return startConsoleRuntime({
    uiDirectory: fileURLToPath(new URL("./ui", import.meta.url)),
    operations: [
      createProjectInspectOperation(projectRoot),
      ...appsScriptOperations,
    ],
    openBrowser,
  });
}
import { loadGasboostConfig } from "@gasboost/config";
