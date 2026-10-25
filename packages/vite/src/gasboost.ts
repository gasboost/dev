import type { Plugin } from "vite";
import { createBuildPlugin } from "./build";
import { createDevPlugin } from "./dev";

export type GasRuntime = Readonly<Record<string, unknown>>;

export interface GasboostOptions {
  entry: string;
  envDir?: string;
  localRpc?: {
    override?: boolean;
    database?: Record<string, Record<string, Record<string, unknown>[]>>;
    auth?: {
      emulator: {
        host?: string;
        port?: number;
      };
    };
    rtdb?: {
      emulator: {
        namespace: string;
        host?: string;
        port?: number;
      };
    };
  };
  runtime?: GasRuntime;
  template?: Record<string, string>;
}

export function gasboost(options: GasboostOptions): {
  build: Plugin;
  dev: Plugin;
} {
  return {
    build: createBuildPlugin(options),
    dev: createDevPlugin(options),
  };
}
