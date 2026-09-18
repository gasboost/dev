import { access } from "node:fs/promises";
import { resolve } from "node:path";
import type {
  GasboostConfig,
  GasboostFirebaseConfig,
  NormalizedGasboostConfig,
} from "./GasboostConfig.js";
import { ModuleLoader } from "./ModuleLoader.js";

export async function loadGasboostConfig({
  projectRoot,
}: {
  readonly projectRoot: string;
}): Promise<NormalizedGasboostConfig> {
  const configPath = resolve(projectRoot, "gasboost.config.ts");

  try {
    await access(configPath);
  } catch {
    throw new Error(`Gasboost config was not found: ${configPath}`);
  }

  const configModule = await new ModuleLoader(projectRoot).import<{
    readonly default?: unknown;
  }>("gasboost.config.ts");
  const config = configModule.default;

  if (typeof config !== "object" || config === null || Array.isArray(config)) {
    throw new Error(
      "gasboost.config.ts must export a Gasboost config as the default export.",
    );
  }

  return normalizeGasboostConfig(config as GasboostConfig);
}

export function normalizeGasboostConfig(
  config: GasboostConfig,
): NormalizedGasboostConfig {
  const realtimeDatabase = config.firebase?.realtimeDatabase ?? config.rtdb;
  const firebase: GasboostFirebaseConfig | undefined =
    realtimeDatabase === undefined
      ? config.firebase
      : { ...config.firebase, realtimeDatabase };

  return {
    ...(config.appsScript === undefined
      ? {}
      : { appsScript: config.appsScript }),
    ...(firebase === undefined ? {} : { firebase }),
  };
}
