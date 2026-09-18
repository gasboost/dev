import type { GasboostAppsScriptConfig } from "@gasboost/config";
import { readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";

export type AppsScriptProjectState = {
  readonly configured: boolean;
  readonly scriptId?: string;
  readonly rootDir: string;
  readonly manifestExists: boolean;
};

export class AppsScriptProjectRepository {
  private readonly projectRoot: string;
  private readonly config: GasboostAppsScriptConfig;

  public constructor({
    projectRoot,
    config,
  }: {
    readonly projectRoot: string;
    readonly config: GasboostAppsScriptConfig;
  }) {
    this.projectRoot = projectRoot;
    this.config = config;
  }

  public async read(): Promise<AppsScriptProjectState> {
    const settings = await this.readClaspSettings();
    const manifestExists = await this.exists(
      join(this.projectRoot, settings.rootDir, "appsscript.json"),
    );

    return { ...settings, manifestExists };
  }

  public async connect(scriptId: string): Promise<void> {
    const current = (await this.readClaspObject()) ?? {};
    const rootDir =
      typeof current.rootDir === "string"
        ? current.rootDir
        : (this.config.rootDir ?? ".");
    await writeFile(
      join(this.projectRoot, ".clasp.json"),
      `${JSON.stringify({ ...current, scriptId, rootDir }, null, 2)}\n`,
      "utf8",
    );
  }

  private async readClaspSettings(): Promise<{
    readonly configured: boolean;
    readonly scriptId?: string;
    readonly rootDir: string;
  }> {
    const fallback = {
      configured: false,
      rootDir: this.config.rootDir ?? ".",
    } as const;

    const value = await this.readClaspObject();
    if (value === undefined) return fallback;

    if (typeof value.scriptId !== "string" || value.scriptId.length === 0) {
      return fallback;
    }

    return {
      configured: true,
      scriptId: value.scriptId,
      rootDir:
        typeof value.rootDir === "string"
          ? value.rootDir
          : (this.config.rootDir ?? "."),
    };
  }

  private async readClaspObject(): Promise<Record<string, unknown> | undefined> {
    try {
      const value = JSON.parse(
        await readFile(join(this.projectRoot, ".clasp.json"), "utf8"),
      ) as unknown;
      if (typeof value !== "object" || value === null || Array.isArray(value)) {
        throw new Error("Expected a JSON object.");
      }
      return value as Record<string, unknown>;
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
        ".clasp.json exists but does not contain valid project settings.",
        { cause: error },
      );
    }
  }

  private async exists(path: string): Promise<boolean> {
    try {
      await readFile(path, "utf8");
      return true;
    } catch (error) {
      if (
        typeof error === "object" &&
        error !== null &&
        "code" in error &&
        error.code === "ENOENT"
      ) {
        return false;
      }
      throw error;
    }
  }
}
