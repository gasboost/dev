export type GasboostAppsScriptConfig = {
  readonly type: "webapp";
  readonly rootDir?: string;
};

export type GasboostRtdbConfig = {
  readonly source: string;
  readonly out: string;
};

export type GasboostFirebaseConfig = {
  readonly realtimeDatabase?: GasboostRtdbConfig;
};

export type GasboostConfig = {
  readonly appsScript?: GasboostAppsScriptConfig;
  readonly firebase?: GasboostFirebaseConfig;
  /** @deprecated Use firebase.realtimeDatabase instead. */
  readonly rtdb?: GasboostRtdbConfig;
};

export type NormalizedGasboostConfig = {
  readonly appsScript?: GasboostAppsScriptConfig;
  readonly firebase?: GasboostFirebaseConfig;
};

export function defineGasboostConfig(config: GasboostConfig): GasboostConfig {
  return config;
}
