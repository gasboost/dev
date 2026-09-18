import type { GasboostAppsScriptConfig } from "@gasboost/config";
import type {
  OperationContext,
  OperationDefinition,
} from "@gasboost/console-runtime";
import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { z } from "zod";
import type { ClaspResult, ClaspRunner } from "./ClaspRunner.js";

export type AppsScriptStatus = {
  readonly authenticated: boolean;
  readonly configured: boolean;
  readonly scriptId?: string;
  readonly rootDir: string;
};

type AppsScriptOperation = OperationDefinition<any, unknown>;

const emptyInput = z.object({}).strict();
const createInput = z
  .object({
    title: z.string().trim().min(1).max(100),
  })
  .strict();
const pushInput = z.object({ confirmed: z.literal(true) }).strict();

export function createAppsScriptOperations({
  projectRoot,
  config,
  clasp,
}: {
  readonly projectRoot: string;
  readonly config: GasboostAppsScriptConfig;
  readonly clasp: ClaspRunner;
}): readonly AppsScriptOperation[] {
  const status = async (): Promise<AppsScriptStatus> =>
    getAppsScriptStatus({ projectRoot, config, clasp });

  return [
    {
      id: "apps.status",
      input: emptyInput,
      async handler(_input, context) {
        context.progress({ message: "Checking Apps Script", percentage: 25 });
        const result = await status();
        context.progress({ message: "Apps Script ready", percentage: 100 });
        return result;
      },
    },
    {
      id: "apps.login",
      input: emptyInput,
      async handler(_input, context) {
        context.progress({ message: "Starting Google authorization" });
        const result = await clasp.run(["login"], context.log);
        assertClaspSuccess("Apps Script authorization", result);
        context.progress({ message: "Authorization complete", percentage: 100 });
        return status();
      },
    },
    {
      id: "apps.create",
      input: createInput,
      async handler(input, context) {
        const current = await readProjectSettings(projectRoot, config);
        if (current.configured) {
          throw new Error("An Apps Script project is already configured.");
        }

        context.progress({ message: "Creating Apps Script project", percentage: 20 });
        const args = [
          "create-script",
          "--type",
          config.type,
          "--title",
          input.title,
          "--rootDir",
          config.rootDir ?? ".",
        ];
        const result = await clasp.run(args, context.log);
        assertClaspSuccess("Apps Script project creation", result);
        context.progress({ message: "Apps Script project created", percentage: 100 });
        return status();
      },
    },
    {
      id: "apps.open",
      input: emptyInput,
      async handler(_input, context) {
        await assertProjectConfigured(projectRoot, config);
        const result = await clasp.run(["open-script"], context.log);
        assertClaspSuccess("Opening Apps Script editor", result);
        return { opened: true };
      },
    },
    {
      id: "apps.push",
      input: pushInput,
      async handler(_input, context) {
        await assertProjectConfigured(projectRoot, config);
        context.progress({ message: "Pushing local files", percentage: 20 });
        const result = await clasp.run(["push", "--force"], context.log);
        assertClaspSuccess("Apps Script push", result);
        context.progress({ message: "Push complete", percentage: 100 });
        return { pushed: true };
      },
    },
  ];
}

async function getAppsScriptStatus({
  projectRoot,
  config,
  clasp,
}: {
  readonly projectRoot: string;
  readonly config: GasboostAppsScriptConfig;
  readonly clasp: ClaspRunner;
}): Promise<AppsScriptStatus> {
  const [project, authorization] = await Promise.all([
    readProjectSettings(projectRoot, config),
    clasp.run(["show-authorized-user", "--json"]),
  ]);

  return {
    authenticated: authorization.exitCode === 0,
    configured: project.configured,
    ...(project.scriptId === undefined ? {} : { scriptId: project.scriptId }),
    rootDir: project.rootDir,
  };
}

async function readProjectSettings(
  projectRoot: string,
  config: GasboostAppsScriptConfig,
): Promise<{
  readonly configured: boolean;
  readonly scriptId?: string;
  readonly rootDir: string;
}> {
  const fallback = { configured: false, rootDir: config.rootDir ?? "." } as const;

  try {
    const value = JSON.parse(
      await readFile(join(projectRoot, ".clasp.json"), "utf8"),
    ) as { readonly scriptId?: unknown; readonly rootDir?: unknown };

    if (typeof value.scriptId !== "string" || value.scriptId.length === 0) {
      return fallback;
    }

    return {
      configured: true,
      scriptId: value.scriptId,
      rootDir:
        typeof value.rootDir === "string"
          ? value.rootDir
          : (config.rootDir ?? "."),
    };
  } catch (error) {
    if (
      typeof error === "object" &&
      error !== null &&
      "code" in error &&
      error.code === "ENOENT"
    ) {
      return fallback;
    }

    throw new Error(
      ".clasp.json exists but does not contain valid project settings.",
      { cause: error },
    );
  }
}

async function assertProjectConfigured(
  projectRoot: string,
  config: GasboostAppsScriptConfig,
): Promise<void> {
  if (!(await readProjectSettings(projectRoot, config)).configured) {
    throw new Error("Create or connect an Apps Script project first.");
  }
}

function assertClaspSuccess(action: string, result: ClaspResult): void {
  if (result.exitCode === 0) return;
  const diagnostic = result.stderr.trim() || result.stdout.trim();
  throw new Error(
    diagnostic.length === 0 ? `${action} failed.` : `${action} failed: ${diagnostic}`,
  );
}
