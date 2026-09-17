export type GasboostRtdbConfig = {
  readonly source: string;
  readonly out: string;
};

export type GasboostConfig = {
  readonly rtdb?: GasboostRtdbConfig;
};

export function defineGasboostConfig(config: GasboostConfig): GasboostConfig {
  return config;
}
