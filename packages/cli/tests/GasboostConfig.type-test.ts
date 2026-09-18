import { defineGasboostConfig, type GasboostConfig } from "../src/index.js";

const config: GasboostConfig = defineGasboostConfig({
  appsScript: { type: "webapp" },
  firebase: {
    realtimeDatabase: {
      source: "./src/backend/lib/rtdb.ts",
      out: "./database.rules.json",
    },
  },
});

void config;

defineGasboostConfig({
  firebase: {
    // @ts-expect-error source is required
    realtimeDatabase: {
      out: "./database.rules.json",
    },
  },
});

defineGasboostConfig({
  firebase: {
    // @ts-expect-error out is required
    realtimeDatabase: {
      source: "./src/backend/lib/rtdb.ts",
    },
  },
});

defineGasboostConfig({
  rtdb: {
    source: "./src/backend/lib/rtdb.ts",
    out: "./database.rules.json",
  },
});
