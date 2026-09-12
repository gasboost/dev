import { defineGasboostConfig, type GasboostConfig } from "../src/index.js";

const config: GasboostConfig = defineGasboostConfig({
  rtdb: {
    source: "./src/backend/lib/rtdb.ts",
    out: "./database.rules.json",
  },
});

void config;

defineGasboostConfig({
  // @ts-expect-error source is required
  rtdb: {
    out: "./database.rules.json",
  },
});

defineGasboostConfig({
  // @ts-expect-error out is required
  rtdb: {
    source: "./src/backend/lib/rtdb.ts",
  },
});
