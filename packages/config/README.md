# @gasboost/config

Gasboost project definitions and their loader.

```ts
import { defineGasboostConfig } from "@gasboost/config";

export default defineGasboostConfig({
  appsScript: { type: "webapp" },
  firebase: {
    realtimeDatabase: {
      source: "./src/server/lib/rtdb.ts",
      out: "./database.rules.json",
    },
  },
});
```
