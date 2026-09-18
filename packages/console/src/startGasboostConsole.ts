import {
  startConsoleRuntime,
  type ConsoleRuntime,
} from "@gasboost/console-runtime";
import { fileURLToPath } from "node:url";
import { createProjectInspectOperation } from "./projectInspectOperation.js";

export async function startGasboostConsole({
  projectRoot,
  openBrowser = true,
}: {
  readonly projectRoot: string;
  readonly openBrowser?: boolean;
}): Promise<ConsoleRuntime> {
  return startConsoleRuntime({
    uiDirectory: fileURLToPath(new URL("./ui", import.meta.url)),
    operations: [createProjectInspectOperation(projectRoot)],
    openBrowser,
  });
}
