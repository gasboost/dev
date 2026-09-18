import { loadGasboostConfig } from "@gasboost/config";
import type { OperationDefinition } from "@gasboost/console-runtime";
import { basename } from "node:path";
import { z } from "zod";

export type ProjectState = {
  readonly name: string;
  readonly root: string;
  readonly capabilities: {
    readonly appsScript: boolean;
    readonly firebaseRealtimeDatabase: boolean;
  };
};

export function createProjectInspectOperation(
  projectRoot: string,
): OperationDefinition<Record<string, never>, ProjectState> {
  return {
    id: "project.inspect",
    input: z.object({}).strict(),
    async handler(_input, context) {
      context.progress({ message: "Loading project definition", percentage: 25 });
      const config = await loadGasboostConfig({ projectRoot });
      context.log("gasboost.config.ts loaded");
      context.progress({ message: "Project ready", percentage: 100 });

      return {
        name: basename(projectRoot),
        root: projectRoot,
        capabilities: {
          appsScript: config.appsScript !== undefined,
          firebaseRealtimeDatabase:
            config.firebase?.realtimeDatabase !== undefined,
        },
      };
    },
  };
}
