# gasboost/dev

Developer experience and project lifecycle tooling for the gasboost ecosystem.

This monorepo contains the packages responsible for creating, configuring, developing, connecting, and operating a gasboost project.

```text
gasboost/dev

packages/
├─ create-gasboost   @gasboost/create
├─ config            @gasboost/config
├─ cli               @gasboost/cli
├─ console           @gasboost/console
└─ console-runtime   @gasboost/console-runtime
```

## Quick Start

Create a new gasboost project:

```bash
npm create @gasboost -- my-app
```

Or run the package directly:

```bash
pnpm dlx @gasboost/create my-app
```

Then:

```bash
cd my-app
pnpm install
pnpm dev
```

Open the project console:

```bash
pnpm console
```

The normal project lifecycle is:

```text
create
  ↓
local development
  ↓
console
  ↓
Apps Script / Firebase / Deployment setup
```

`@gasboost/create` generates the local project structure.

`gasboost console` then manages the lifecycle around that project without turning the generator into a setup wizard.

## Packages

### @gasboost/create

The entry point for creating a new gasboost project.

Instead of asking users to choose package names directly, the generator asks which application capabilities are needed:

```text
Database
Authentication
Frontend
Realtime
```

Those capabilities are resolved into the required packages, configuration, and source files.

```text
what you want to build
        ↓
capabilities
        ↓
required packages
        ↓
config + source files
        ↓
minimal runnable project
```

The generator intentionally does not create tutorial applications or perform hidden external-resource setup.

Package:

```text
packages/create-gasboost
```

npm:

```text
@gasboost/create
```

### @gasboost/config

Defines and loads `gasboost.config.ts`.

`gasboost.config.ts` is the project's:

> gasboost Project Definition / Desired State

It describes what infrastructure and capabilities the project intends to use.

It is not a storage location for credentials or remote actual state.

For example:

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

Package:

```text
packages/config
```

npm:

```text
@gasboost/config
```

### @gasboost/cli

The developer-facing command entry point.

Current commands include:

```bash
gasboost console open
gasboost rtdb rules
```

The CLI is responsible for command routing and developer-facing orchestration such as:

- loading `gasboost.config.ts`
- starting the project console
- loading application TypeScript modules
- generating RTDB Security Rules
- writing generated files
- reporting diagnostics and exit status

The browser console itself is implemented by `@gasboost/console`.

Package:

```text
packages/cli
```

npm:

```text
@gasboost/cli
```

### @gasboost/console

The local GUI for the gasboost project lifecycle.

Open it with:

```bash
gasboost console open
```

or from a generated project:

```bash
pnpm console
```

The main sections are:

```text
Overview
Development
Apps Script
Deployment
Firebase
```

The console combines project Desired State with detected Actual State.

```text
gasboost.config.ts
        ↓
   Desired State


.clasp.json
appsscript.json
.env
CLI authentication
remote resource state
        ↓
    Actual State


Desired + Actual
        ↓
   gasboost console
```

Sections remain accessible even when a capability or external resource has not been configured yet.

Instead of hiding the section, the console presents the appropriate setup, connect, or enable operation.

The console executes registered operations only. It is not an arbitrary shell launcher.

Package:

```text
packages/console
```

npm:

```text
@gasboost/console
```

### @gasboost/console-runtime

The generic localhost runtime used by `@gasboost/console`.

It intentionally has no gasboost-, clasp-, Firebase-, or Apps Script-specific lifecycle knowledge.

Its responsibilities are infrastructure-level concerns such as:

- localhost server lifecycle
- browser transport
- registered operation execution
- progress, log, and result transport
- session security
- origin validation
- structured input validation

The browser can invoke only registered operation IDs with input accepted by the operation's Zod schema.

There is no arbitrary shell or generic executable endpoint.

Package:

```text
packages/console-runtime
```

npm:

```text
@gasboost/console-runtime
```

## Project State Model

The developer tooling separates desired configuration from discovered state.

### Desired State

Declared by:

```text
gasboost.config.ts
```

Examples include:

- Apps Script web application capability
- output directory
- Firebase Realtime Database rules source
- generated rules destination

### Actual State

Discovered from the local environment and connected providers.

Examples include:

```text
.clasp.json
appsscript.json
.env
Google / clasp authentication state
Apps Script project state
deployment state
Firebase project state
```

The console compares these two views to determine which lifecycle operations are currently available.

## Security Model

Developer tooling must not turn the browser UI into an arbitrary local command executor.

Console operations follow this model:

```text
browser
  ↓
registered operation ID
  ↓
Zod-validated structured input
  ↓
known operation implementation
  ↓
progress / log / result
```

There is no generic shell endpoint and no arbitrary executable + arguments API.

Sensitive credentials are also not silently created or registered.

For example, Firebase service-account private keys are not entered into or stored by the console. The console may guide the user to the relevant provider UI and Apps Script Project Settings, but the user explicitly configures Script Properties themselves.

## Repository Development

Install dependencies:

```bash
pnpm install
```

Build all packages:

```bash
pnpm -r build
```

Typecheck:

```bash
pnpm -r typecheck
```

Run tests:

```bash
pnpm -r test
```

The repository also contains package-specific E2E and packed-package smoke tests used by CI.

## Requirements

- Node.js 24+
- pnpm

## License

MIT
