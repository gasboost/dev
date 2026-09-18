import type { GasboostAppsScriptConfig } from "@gasboost/config";
import type { OperationDefinition } from "@gasboost/console-runtime";
import { z } from "zod";
import { EnvFileRepository } from "../env/EnvFileRepository.js";
import { AppsScriptProjectRepository } from "./AppsScriptProjectRepository.js";
import type { ClaspResult, ClaspRunner } from "./ClaspRunner.js";

export type AppsScriptStatus = {
  readonly authenticated: boolean;
  readonly configured: boolean;
  readonly scriptId?: string;
  readonly rootDir: string;
  readonly manifestExists: boolean;
  readonly desired: boolean;
  readonly deploymentId?: string;
};

type AppsScriptOperation = OperationDefinition<any, unknown>;

const emptyInput = z.object({}).strict();
const createInput = z
  .object({
    title: z.string().trim().min(1).max(100),
  })
  .strict();
const connectInput = z
  .object({
    scriptId: z.string().trim().min(6).max(200),
  })
  .strict();
const pushInput = z.object({ confirmed: z.literal(true) }).strict();
const createDeploymentInput = z
  .object({
    description: z.string().trim().max(120).optional(),
  })
  .strict();
const updateDeploymentInput = z
  .object({
    deploymentId: z.string().trim().min(1).max(200).optional(),
    description: z.string().trim().max(120).optional(),
  })
  .strict();
const credentialsInput = z
  .object({
    clientEmail: z.string().trim().email(),
    privateKey: z.string().min(20),
  })
  .strict();

const defaultAppsScriptConfig: GasboostAppsScriptConfig = { type: "webapp" };

export function createAppsScriptOperations({
  projectRoot,
  config,
  clasp,
}: {
  readonly projectRoot: string;
  readonly config?: GasboostAppsScriptConfig;
  readonly clasp: ClaspRunner;
}): readonly AppsScriptOperation[] {
  const effectiveConfig = config ?? defaultAppsScriptConfig;
  const projectRepository = new AppsScriptProjectRepository({
    projectRoot,
    config: effectiveConfig,
  });
  const envRepository = new EnvFileRepository(projectRoot);
  const status = async (): Promise<AppsScriptStatus> =>
    getAppsScriptStatus({
      configDesired: config !== undefined,
      projectRepository,
      envRepository,
      clasp,
    });

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
        const current = await projectRepository.read();
        if (current.configured) {
          throw new Error("An Apps Script project is already configured.");
        }

        context.progress({ message: "Creating Apps Script project", percentage: 20 });
        const args = [
          "create-script",
          "--type",
          effectiveConfig.type,
          "--title",
          input.title,
          "--rootDir",
          effectiveConfig.rootDir ?? ".",
        ];
        const result = await clasp.run(args, context.log);
        assertClaspSuccess("Apps Script project creation", result);
        await syncScriptId(projectRepository, envRepository);
        context.progress({ message: "Apps Script project created", percentage: 100 });
        return status();
      },
    },
    {
      id: "apps.connect",
      input: connectInput,
      async handler(input, context) {
        context.progress({ message: "Connecting Apps Script project", percentage: 30 });
        await projectRepository.connect(input.scriptId);
        await envRepository.update({ GAS_SCRIPT_ID: input.scriptId });
        context.progress({ message: "Apps Script project connected", percentage: 100 });
        return status();
      },
    },
    {
      id: "apps.open",
      input: emptyInput,
      async handler(_input, context) {
        await assertProjectConfigured(projectRepository);
        const result = await clasp.run(["open-script"], context.log);
        assertClaspSuccess("Opening Apps Script editor", result);
        return { opened: true };
      },
    },
    {
      id: "apps.push",
      input: pushInput,
      async handler(_input, context) {
        await assertProjectConfigured(projectRepository);
        context.progress({ message: "Pushing local files", percentage: 20 });
        const result = await clasp.run(["push", "--force"], context.log);
        assertClaspSuccess("Apps Script push", result);
        context.progress({ message: "Push complete", percentage: 100 });
        return { pushed: true };
      },
    },
    {
      id: "apps.deployments",
      input: emptyInput,
      async handler(_input, context) {
        await assertProjectConfigured(projectRepository);
        const result = await clasp.run(["deployments", "--json"], context.log);
        assertClaspSuccess("Loading deployments", result);
        return parseDeployments(result.stdout);
      },
    },
    {
      id: "apps.deployment.create",
      input: createDeploymentInput,
      async handler(input, context) {
        await assertProjectConfigured(projectRepository);
        const args = ["create-deployment"];
        if (input.description !== undefined && input.description.length > 0) {
          args.push("--description", input.description);
        }
        const result = await clasp.run(args, context.log);
        assertClaspSuccess("Creating deployment", result);
        const deploymentId = extractDeploymentId(result.stdout);
        if (deploymentId !== undefined) {
          await envRepository.update({ DEPLOYMENT_ID: deploymentId });
        }
        return { deploymentId };
      },
    },
    {
      id: "apps.deployment.update",
      input: updateDeploymentInput,
      async handler(input, context) {
        await assertProjectConfigured(projectRepository);
        const env = await envRepository.read();
        const deploymentId = input.deploymentId ?? env.DEPLOYMENT_ID;
        if (deploymentId === undefined || deploymentId.length === 0) {
          throw new Error("Select or create a deployment first.");
        }
        const args = ["update-deployment", "--deploymentId", deploymentId];
        if (input.description !== undefined && input.description.length > 0) {
          args.push("--description", input.description);
        }
        const result = await clasp.run(args, context.log);
        assertClaspSuccess("Updating deployment", result);
        await envRepository.update({ DEPLOYMENT_ID: deploymentId });
        return { deploymentId };
      },
    },
    {
      id: "apps.credentials.register",
      input: credentialsInput,
      async handler(input, context) {
        const project = await assertProjectConfigured(projectRepository);
        const env = await envRepository.read();
        if (env.FIREBASE_PROJECT_ID === undefined) {
          throw new Error("Connect a Firebase project before registering credentials.");
        }

        context.progress({ message: "Registering Script Properties", percentage: 30 });
        const result = await clasp.run(
          [
            "run",
            "gasboostSetScriptProperties",
            "--params",
            JSON.stringify([
              {
                GAS_SCRIPT_ID: project.scriptId,
                FIREBASE_PROJECT_ID: env.FIREBASE_PROJECT_ID,
                FIREBASE_CLIENT_EMAIL: input.clientEmail,
                FIREBASE_PRIVATE_KEY: input.privateKey,
              },
            ]),
          ],
          redactSecret(input.privateKey, context.log),
        );
        assertClaspSuccess("Registering Script Properties", result);
        context.progress({ message: "Credentials registered", percentage: 100 });
        return { registered: true };
      },
    },
  ];
}

async function getAppsScriptStatus({
  configDesired,
  projectRepository,
  envRepository,
  clasp,
}: {
  readonly configDesired: boolean;
  readonly projectRepository: AppsScriptProjectRepository;
  readonly envRepository: EnvFileRepository;
  readonly clasp: ClaspRunner;
}): Promise<AppsScriptStatus> {
  const [project, authorization] = await Promise.all([
    projectRepository.read(),
    clasp.run(["show-authorized-user", "--json"]),
  ]);
  if (project.scriptId !== undefined) {
    await envRepository.update({ GAS_SCRIPT_ID: project.scriptId });
  }
  const runtime = await envRepository.read();

  return {
    authenticated: authorization.exitCode === 0,
    configured: project.configured,
    ...(project.scriptId === undefined ? {} : { scriptId: project.scriptId }),
    rootDir: project.rootDir,
    manifestExists: project.manifestExists,
    desired: configDesired,
    ...(runtime.DEPLOYMENT_ID === undefined
      ? {}
      : { deploymentId: runtime.DEPLOYMENT_ID }),
  };
}

async function assertProjectConfigured(
  projectRepository: AppsScriptProjectRepository,
): Promise<{ readonly scriptId: string }> {
  const project = await projectRepository.read();
  if (!project.configured || project.scriptId === undefined) {
    throw new Error("Create or connect an Apps Script project first.");
  }
  return { scriptId: project.scriptId };
}

function assertClaspSuccess(action: string, result: ClaspResult): void {
  if (result.exitCode === 0) return;
  const diagnostic = result.stderr.trim() || result.stdout.trim();
  throw new Error(
    diagnostic.length === 0 ? `${action} failed.` : `${action} failed: ${diagnostic}`,
  );
}

async function syncScriptId(
  projectRepository: AppsScriptProjectRepository,
  envRepository: EnvFileRepository,
): Promise<void> {
  const project = await projectRepository.read();
  if (project.scriptId !== undefined) {
    await envRepository.update({ GAS_SCRIPT_ID: project.scriptId });
  }
}

function parseDeployments(stdout: string): {
  readonly deployments: readonly { readonly deploymentId: string; readonly description?: string }[];
} {
  try {
    const value = JSON.parse(stdout) as unknown;
    if (!Array.isArray(value)) return { deployments: [] };
    return {
      deployments: value.flatMap((item) => {
        if (typeof item !== "object" || item === null) return [];
        const deploymentId = "deploymentId" in item ? item.deploymentId : undefined;
        const description = "description" in item ? item.description : undefined;
        if (typeof deploymentId !== "string") return [];
        return [
          {
            deploymentId,
            ...(typeof description === "string" ? { description } : {}),
          },
        ];
      }),
    };
  } catch {
    return { deployments: [] };
  }
}

function extractDeploymentId(stdout: string): string | undefined {
  return /(?:Deployment ID|deploymentId)[:\s]+([A-Za-z0-9_-]+)/.exec(stdout)?.[1];
}

function redactSecret(
  secret: string,
  log: (message: string) => void,
): (message: string) => void {
  return (message) => log(message.split(secret).join("[redacted]"));
}
