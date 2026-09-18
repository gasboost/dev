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
    const [settings, manifestExists] = await Promise.all([
      this.readClaspSettings(),
      this.exists(join(this.projectRoot, "appsscript.json")),
    ]);

    return { ...settings, manifestExists };
  }

  public async connect(scriptId: string): Promise<void> {
    const current = await this.read();
    const rootDir = current.rootDir;
    await writeFile(
      join(this.projectRoot, ".clasp.json"),
      `${JSON.stringify({ scriptId, rootDir }, null, 2)}\n`,
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

    try {
      const value = JSON.parse(
        await readFile(join(this.projectRoot, ".clasp.json"), "utf8"),
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
            : (this.config.rootDir ?? "."),
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
