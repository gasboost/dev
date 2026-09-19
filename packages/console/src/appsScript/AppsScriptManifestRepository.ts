import { readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";

export const deploymentTypes = ["webapp", "executionApi"] as const;
export const deploymentAccessValues = [
  "MYSELF",
  "DOMAIN",
  "ANYONE",
  "ANYONE_ANONYMOUS",
] as const;
export const webAppExecuteAsValues = [
  "USER_ACCESSING",
  "USER_DEPLOYING",
] as const;

export type DeploymentType = (typeof deploymentTypes)[number];
export type DeploymentAccess = (typeof deploymentAccessValues)[number];
export type WebAppExecuteAs = (typeof webAppExecuteAsValues)[number];

export type DeploymentConfiguration =
  | {
      readonly type: "webapp";
      readonly access: DeploymentAccess;
      readonly executeAs: WebAppExecuteAs;
    }
  | {
      readonly type: "executionApi";
      readonly access: DeploymentAccess;
    };

type ManifestObject = Record<string, unknown>;

const defaultWebAppConfiguration: Extract<
  DeploymentConfiguration,
  { readonly type: "webapp" }
> = {
  type: "webapp",
  access: "ANYONE",
  executeAs: "USER_DEPLOYING",
};

const defaultExecutionApiConfiguration: Extract<
  DeploymentConfiguration,
  { readonly type: "executionApi" }
> = {
  type: "executionApi",
  access: "ANYONE",
};

export class AppsScriptManifestRepository {
  private readonly path: string;

  public constructor(projectRoot: string) {
    this.path = join(projectRoot, "appsscript.json");
  }

  public async readDeploymentConfiguration(
    fallbackType: DeploymentType = "webapp",
  ): Promise<{
    readonly exists: boolean;
    readonly configuration: DeploymentConfiguration;
    readonly source: "manifest" | "default";
  }> {
    const manifest = await this.read();
    if (manifest === undefined) {
      return {
        exists: false,
        configuration: defaultConfiguration(fallbackType),
        source: "default",
      };
    }

    const configuration = parseDeploymentConfiguration(manifest);
    return {
      exists: true,
      configuration: configuration ?? defaultConfiguration(fallbackType),
      source: configuration === undefined ? "default" : "manifest",
    };
  }

  public async updateDeploymentConfiguration(
    configuration: DeploymentConfiguration,
  ): Promise<DeploymentConfiguration> {
    const manifest = (await this.read()) ?? {};
    if (configuration.type === "webapp") {
      manifest.webapp = {
        access: configuration.access,
        executeAs: configuration.executeAs,
      };
      delete manifest.executionApi;
    } else {
      manifest.executionApi = {
        access: configuration.access,
      };
      delete manifest.webapp;
    }

    await writeFile(this.path, `${JSON.stringify(manifest, null, 2)}\n`, "utf8");
    return configuration;
  }

  private async read(): Promise<ManifestObject | undefined> {
    try {
      const value = JSON.parse(await readFile(this.path, "utf8")) as unknown;
      if (typeof value !== "object" || value === null || Array.isArray(value)) {
        throw new Error("Expected a JSON object.");
      }
      return value as ManifestObject;
    } catch (error) {
      if (
        typeof error === "object" &&
        error !== null &&
        "code" in error &&
        error.code === "ENOENT"
      ) {
        return undefined;
      }

      throw new Error(
        "appsscript.json exists but does not contain a valid manifest object.",
        { cause: error },
      );
    }
  }
}

function parseDeploymentConfiguration(
  manifest: ManifestObject,
): DeploymentConfiguration | undefined {
  if (isRecord(manifest.webapp)) {
    return {
      type: "webapp",
      access: parseAccess(manifest.webapp.access) ?? defaultWebAppConfiguration.access,
      executeAs:
        parseExecuteAs(manifest.webapp.executeAs) ?? defaultWebAppConfiguration.executeAs,
    };
  }

  if (isRecord(manifest.executionApi)) {
    return {
      type: "executionApi",
      access:
        parseAccess(manifest.executionApi.access) ??
        defaultExecutionApiConfiguration.access,
    };
  }

  return undefined;
}

function defaultConfiguration(type: DeploymentType): DeploymentConfiguration {
  return type === "executionApi"
    ? defaultExecutionApiConfiguration
    : defaultWebAppConfiguration;
}

function parseAccess(value: unknown): DeploymentAccess | undefined {
  return deploymentAccessValues.find((candidate) => candidate === value);
}

function parseExecuteAs(value: unknown): WebAppExecuteAs | undefined {
  return webAppExecuteAsValues.find((candidate) => candidate === value);
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
