import { defineGasboostConfig, type GasboostConfig } from "../src/index.js";

const config: GasboostConfig = defineGasboostConfig({
  appsScript: { type: "webapp", rootDir: "./dist" },
  firebase: {
    realtimeDatabase: {
      source: "./src/server/lib/rtdb.ts",
      out: "./database.rules.json",
    },
  },
});

void config;

defineGasboostConfig({
  appsScript: {
    // @ts-expect-error webapp is currently the only supported project type
    type: "library",
  },
});
