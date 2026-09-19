# @gasboost/cli

Developer-facing command entry point for the gasboost ecosystem.

Install:

```bash
pnpm add -D @gasboost/cli
```

The CLI coordinates developer tooling around a gasboost project.

Its responsibilities include:

- command routing
- loading project configuration
- opening the gasboost console
- loading application TypeScript modules
- generating RTDB Security Rules
- filesystem output
- diagnostics
- process exit status

## Commands

### Project Console

Open the local project console:

```bash
gasboost console open
```

Generated projects normally expose:

```json
{
  "scripts": {
    "console": "gasboost console open"
  }
}
```

so the console can be opened with:

```bash
pnpm console
```

To avoid automatically opening the browser:

```bash
gasboost console open --no-browser
```

The browser UI itself is implemented by `@gasboost/console`.

The CLI is responsible for starting it and connecting it to the current project.

Console operations are registered operations with structured input. The browser is not given an arbitrary local shell endpoint.

### RTDB Security Rules

Generate Firebase Realtime Database Security Rules:

```bash
gasboost rtdb rules
```

Configuration is read from:

```text
gasboost.config.ts
```

Canonical configuration:

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

The legacy:

```ts
rtdb: {
  source: "...",
  out: "...",
}
```

shape is normalized for compatibility, but new projects should use:

```text
firebase.realtimeDatabase
```

## Project Configuration

`gasboost.config.ts` is loaded through `@gasboost/config`.

It represents the gasboost Project Definition / Desired State rather than CLI-specific preferences.

```text
gasboost.config.ts
        ↓
@gasboost/config
        ↓
@gasboost/cli
```

The canonical config API is:

```ts
import { defineGasboostConfig } from "@gasboost/config";
```

`@gasboost/cli` also re-exports config types for compatibility, but project documentation should use `@gasboost/config` directly.

## RTDB Definition

The module configured by:

```text
firebase.realtimeDatabase.source
```

must export `rtdb`.

For example:

```ts
import { FirebaseRtdb } from "@gasboost/realtime-firebase";
import { itemsTable } from "../../shared/tables";
import { itemsRls } from "./rls";

export const rtdb = FirebaseRtdb.generate({
  tables: [itemsTable] as const,

  rowLevelSecurity: [itemsRls],

  principal: {
    userId: "auth.uid",
  },
});
```

The CLI loads the module and invokes:

```text
rtdb.rules()
```

The resulting rules are written to the configured output.

For example:

```text
database.rules.json
```

## TypeScript Module Loading

The CLI uses `jiti` to load application TypeScript modules.

This allows project modules to use the project's normal TypeScript configuration, including path aliases.

Example:

```json
{
  "compilerOptions": {
    "baseUrl": ".",
    "paths": {
      "@/*": ["./src/*"]
    }
  }
}
```

Application code can continue to use:

```ts
import { something } from "@/something";
```

The application does not need to rewrite imports just for gasboost CLI execution.

## Responsibility Boundaries

`@gasboost/cli` does not implement Firebase authorization compilation or the console UI itself.

For RTDB rules:

```text
@gasboost/realtime-firebase
  ├─ RLS projection
  ├─ authorization layout
  ├─ runtime path generation
  ├─ projectability validation
  └─ Security Rules generation

@gasboost/cli
  ├─ config load
  ├─ TypeScript module load
  ├─ command routing
  ├─ filesystem output
  ├─ diagnostics
  └─ exit code
```

For the project console:

```text
@gasboost/cli
  ↓
start / route command

@gasboost/console
  ↓
gasboost-specific lifecycle UI + operations

@gasboost/console-runtime
  ↓
generic localhost operation runtime
```

## Requirements

- Node.js 24+
- pnpm

## License

MIT
