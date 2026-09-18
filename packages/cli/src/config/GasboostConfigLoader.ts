import { access } from "node:fs/promises";
import { resolve } from "node:path";
import type { ModuleLoader } from "../module/ModuleLoader.js";
import type { GasboostConfig } from "./GasboostConfig.js";

export class GasboostConfigLoader {
  private readonly projectRoot: string;

  private readonly moduleLoader: ModuleLoader;

  public constructor({
    projectRoot,
    moduleLoader,
  }: {
    projectRoot: string;
    moduleLoader: ModuleLoader;
  }) {
    this.projectRoot = projectRoot;
    this.moduleLoader = moduleLoader;
  }

  public async load(): Promise<GasboostConfig> {
    const configPath = resolve(this.projectRoot, "gasboost.config.ts");

    try {
      await access(configPath);
    } catch {
      throw new Error(`Gasboost config was not found: ${configPath}`);
    }

    const configModule = await this.moduleLoader.import<{
      readonly default?: unknown;
    }>("gasboost.config.ts");

    const config = configModule.default;

    if (typeof config !== "object" || config === null) {
      throw new Error(
        "gasboost.config.ts must export a Gasboost config as the default export.",
      );
    }

    return config as GasboostConfig;
  }
}
