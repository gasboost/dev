import type { GasboostAppsScriptConfig } from "@gasboost/config";
import type { OperationDefinition } from "@gasboost/console-runtime";
import { spawn } from "node:child_process";
import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { z } from "zod";
import { EnvFileRepository } from "../env/EnvFileRepository.js";
import { openBrowser } from "../openBrowser.js";
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
type BuildRunner = {
  readonly run: (onOutput?: (line: string) => void) => Promise<ClaspResult>;
};

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
const defaultAppsScriptConfig: GasboostAppsScriptConfig = { type: "webapp" };

export function createAppsScriptOperations({
  projectRoot,
  config,
  clasp,
  build = createBuildRunner(projectRoot),
  browserOpener = openBrowser,
}: {
  readonly projectRoot: string;
  readonly config?: GasboostAppsScriptConfig;
  readonly clasp: ClaspRunner;
  readonly build?: BuildRunner;
  readonly browserOpener?: (url: string) => Promise<void>;
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
        const project = await assertProjectConfigured(projectRepository);
        context.log(`Opening Apps Script editor for ${project.scriptId}`);
        await browserOpener(`https://script.google.com/home/projects/${encodeURIComponent(project.scriptId)}/edit`);
        return { opened: true };
      },
    },
    {
      id: "apps.push",
      input: pushInput,
      async handler(_input, context) {
        await assertProjectConfigured(projectRepository);
        context.progress({ message: "Building deployment artifact", percentage: 20 });
        const buildResult = await build.run(context.log);
        assertCommandSuccess("Build", buildResult);
        context.progress({ message: "Pushing built files", percentage: 70 });
        const result = await clasp.run(["push", "--force"], context.log);
        assertCommandSuccess("Apps Script push", result);
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
        const args = ["update-deployment", deploymentId];
        if (input.description !== undefined && input.description.length > 0) {
          args.push("--description", input.description);
        }
        const result = await clasp.run(args, context.log);
        assertClaspSuccess("Updating deployment", result);
        await envRepository.update({ DEPLOYMENT_ID: deploymentId });
        return { deploymentId };
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
  assertCommandSuccess(action, result);
}

function assertCommandSuccess(action: string, result: ClaspResult): void {
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

function createBuildRunner(projectRoot: string): BuildRunner {
  return {
    async run(onOutput) {
      const command = await resolveBuildCommand(projectRoot);
      return runCommand(command.executable, command.args, projectRoot, onOutput);
    },
  };
}

async function resolveBuildCommand(projectRoot: string): Promise<{
  readonly executable: string;
  readonly args: readonly string[];
}> {
  const packageJson = JSON.parse(await readFile(join(projectRoot, "package.json"), "utf8")) as {
    readonly packageManager?: string;
    readonly scripts?: Record<string, unknown>;
  };

  if (typeof packageJson.scripts?.build !== "string") {
    throw new Error("No package.json build script was found.");
  }

  const packageManager = packageJson.packageManager?.split("@", 1)[0] ?? "npm";
  if (packageManager === "pnpm") return { executable: "pnpm", args: ["run", "build"] };
  if (packageManager === "yarn") return { executable: "yarn", args: ["build"] };
  if (packageManager === "bun") return { executable: "bun", args: ["run", "build"] };
  return { executable: "npm", args: ["run", "build"] };
}

function runCommand(
  executable: string,
  args: readonly string[],
  cwd: string,
  onOutput: ((line: string) => void) | undefined,
): Promise<ClaspResult> {
  return new Promise<ClaspResult>((resolve, reject) => {
    const child = spawn(executable, args, {
      cwd,
      env: { ...process.env, NO_COLOR: "1" },
      shell: process.platform === "win32",
      stdio: ["ignore", "pipe", "pipe"],
    });
    let stdout = "";
    let stderr = "";
    const stdoutLines = createLineEmitter(onOutput);
    const stderrLines = createLineEmitter(onOutput);

    child.stdout.setEncoding("utf8");
    child.stderr.setEncoding("utf8");
    child.stdout.on("data", (chunk: string) => {
      stdout += chunk;
      stdoutLines.write(chunk);
    });
    child.stderr.on("data", (chunk: string) => {
      stderr += chunk;
      stderrLines.write(chunk);
    });
    child.once("error", reject);
    child.once("close", (exitCode) => {
      stdoutLines.flush();
      stderrLines.flush();
      resolve({ exitCode: exitCode ?? 1, stdout, stderr });
    });
  });
}

function createLineEmitter(
  onOutput: ((line: string) => void) | undefined,
): { readonly write: (chunk: string) => void; readonly flush: () => void } {
  let buffer = "";
  const emit = (line: string): void => {
    const message = line.trim();
    if (message.length > 0) onOutput?.(message);
  };

  return {
    write(chunk) {
      buffer += chunk;
      const lines = buffer.split(/\r?\n/);
      buffer = lines.pop() ?? "";
      for (const line of lines) emit(line);
    },
    flush() {
      emit(buffer);
      buffer = "";
    },
  };
}
