# @gasboost/config

Project definition types and configuration loader for gasboost.

## Positioning

`gasboost.config.ts` is the:

> gasboost Project Definition / Desired State

It describes what the project intends to use.

It is not a CLI preference file and it is not a storage location for detected remote state or secrets.

```text
gasboost.config.ts
        ↓
Project Definition
        ↓
Desired State
```

Examples of Desired State include:

- Apps Script application type
- build output directory
- Firebase capability usage
- RTDB Security Rules source
- RTDB Security Rules output

Examples of data that do **not** belong in `gasboost.config.ts` include:

- Firebase private keys
- OAuth tokens
- Google authentication state
- `.clasp.json` state
- deployment IDs discovered from remote APIs
- runtime connection state

Those belong to external providers, environment-specific files, or runtime Actual State.

## Installation

```bash
pnpm add -D @gasboost/config
```

## Configuration

Create:

```text
gasboost.config.ts
```

Canonical example:

```ts
import { defineGasboostConfig } from "@gasboost/config";

export default defineGasboostConfig({
  appsScript: {
    type: "webapp",
    rootDir: "./dist",
  },

  firebase: {
    realtimeDatabase: {
      source: "./src/backend/lib/rtdb.ts",
      out: "./database.rules.json",
    },
  },
});
```

## Apps Script

Apps Script configuration:

```ts
import { defineGasboostConfig } from "@gasboost/config";

export default defineGasboostConfig({
  appsScript: {
    type: "webapp",
    rootDir: "./dist",
  },
});
```

`rootDir` identifies the generated Apps Script build output.

## Firebase Realtime Database

Realtime Database rules configuration:

```ts
import { defineGasboostConfig } from "@gasboost/config";

export default defineGasboostConfig({
  firebase: {
    realtimeDatabase: {
      source: "./src/backend/lib/rtdb.ts",
      out: "./database.rules.json",
    },
  },
});
```

`source` points to the application module that exports the RTDB definition.

`out` is the destination for generated Firebase Realtime Database Security Rules.

## Desired State vs Actual State

The distinction is intentional.

```text
gasboost.config.ts
        ↓
   Desired State


.clasp.json
appsscript.json
.env
authentication state
remote provider state
        ↓
    Actual State
```

Higher-level tooling such as `@gasboost/console` can combine these views when deciding which lifecycle operations are available.

Config itself remains declarative.

## API

### defineGasboostConfig

Provides typed configuration authoring.

```ts
import { defineGasboostConfig } from "@gasboost/config";
```

### loadGasboostConfig

Loads a project configuration from the filesystem.

```ts
import { loadGasboostConfig } from "@gasboost/config";
```

### normalizeGasboostConfig

Normalizes supported configuration shapes into the current internal representation.

```ts
import { normalizeGasboostConfig } from "@gasboost/config";
```

### ModuleLoader

Provides project-aware module loading used by developer tooling.

```ts
import { ModuleLoader } from "@gasboost/config";
```

## Compatibility

Legacy RTDB configuration can still be normalized for compatibility.

New projects should use:

```text
firebase.realtimeDatabase
```

rather than the legacy top-level:

```text
rtdb
```

## License

MIT
