import {
  startConsoleRuntime,
  type ConsoleRuntime,
} from "@gasboost/console-runtime";
import { fileURLToPath } from "node:url";
import { createAppsScriptOperations } from "./appsScript/appsScriptOperations.js";
import { createClaspRunner } from "./appsScript/ClaspRunner.js";
import type { ClaspRunner } from "./appsScript/ClaspRunner.js";
import { createDevelopmentOperations } from "./development/developmentOperations.js";
import { createFirebaseOperations } from "./firebase/firebaseOperations.js";
import { createFirebaseRunner } from "./firebase/FirebaseRunner.js";
import type { FirebaseRunner } from "./firebase/FirebaseRunner.js";
import { createProjectInspectOperation } from "./projectInspectOperation.js";
import { loadGasboostConfig } from "@gasboost/config";

export async function startGasboostConsole({
  projectRoot,
  openBrowser = true,
  clasp = createClaspRunner(projectRoot),
  firebase = createFirebaseRunner(projectRoot),
}: {
  readonly projectRoot: string;
  readonly openBrowser?: boolean;
  readonly clasp?: ClaspRunner;
  readonly firebase?: FirebaseRunner;
}): Promise<ConsoleRuntime> {
  const config = await loadGasboostConfig({ projectRoot });
  const appsScriptOperations = createAppsScriptOperations({
    projectRoot,
    ...(config.appsScript === undefined ? {} : { config: config.appsScript }),
    clasp,
  });
  const firebaseOperations = createFirebaseOperations({
    projectRoot,
    config,
    firebase,
  });
  const development = createDevelopmentOperations({ projectRoot });

  const runtime = await startConsoleRuntime({
    uiDirectory: fileURLToPath(new URL("./ui", import.meta.url)),
    operations: [
      createProjectInspectOperation(projectRoot),
      ...development.operations,
      ...appsScriptOperations,
      ...firebaseOperations,
    ],
    openBrowser,
  });

  return {
    url: runtime.url,
    close: async () => {
      await development.cleanup();
      await runtime.close();
    },
  };
}
