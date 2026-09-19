# @gasboost/console

Local project lifecycle UI for gasboost.

Open the console with:

```bash
gasboost console open
```

Generated projects expose the same command as:

```bash
pnpm console
```

The UI is prebuilt and bundled with this package. Projects do not need a separate Vite configuration for the console itself.

## Project Lifecycle

The console is organized into five sections:

```text
Overview
Development
Apps Script
Deployment
Firebase
```

These sections represent the lifecycle of a gasboost project rather than individual CLI commands.

Sections remain accessible even when their corresponding external capability has not been configured.

If setup is incomplete, the section presents setup, connect, or enable operations instead of disappearing.

## Desired State and Actual State

The console combines the project's declared Desired State with detected Actual State.

### Desired State

Declared by:

```text
gasboost.config.ts
```

```text
gasboost.config.ts
        ↓
   Desired State
```

Examples include:

- Apps Script web application configuration
- build output directory
- Firebase Realtime Database capability
- RTDB rules source and output paths

### Actual State

Actual State is discovered from the local environment and connected external resources.

Examples include:

```text
.clasp.json
appsscript.json
.env
CLI / Google authentication
Apps Script project state
deployment state
Firebase project state
```

```text
local files
provider state
authentication state
       ↓
  Actual State
```

The console combines both views:

```text
Desired State
      +
Actual State
      ↓
gasboost console
```

This makes it possible to show a capability before it has been fully connected and guide the developer toward the next lifecycle operation.

## Overview

Overview presents the current state of the project and its configured or detected capabilities.

It acts as the entry point for understanding what is connected and which setup work remains.

## Development

Development controls the local application lifecycle.

Supported operations include:

```text
start
stop
restart
```

The console can also detect the local development URL and open the running application.

Development runs the project's registered development operation rather than exposing an arbitrary shell command endpoint.

## Apps Script

The Apps Script section manages the Apps Script project lifecycle.

It can surface:

- clasp / Google authorization state
- project creation
- connection to an existing project
- Apps Script editor navigation
- source push
- project settings navigation

Local project state such as `.clasp.json` is treated as Actual State.

The section remains available before an Apps Script project has been connected.

## Deployment

The Deployment section manages Apps Script deployments.

Lifecycle operations include:

```text
list
create
update
open deployed app
```

Deployment state is discovered from the connected Apps Script project rather than stored in `gasboost.config.ts`.

## Firebase

The Firebase section manages the assisted lifecycle around Firebase capabilities.

It can guide the developer through operations such as:

- enable or connect a Firebase project
- open Firebase Console
- Web App setup
- Realtime Database setup
- Security Rules generation
- Security Rules deployment
- assisted credential configuration

The console does not silently create or register sensitive credentials.

## Credentials

Firebase service-account private keys are not entered into, stored by, or automatically registered by the console.

Instead, the console uses an assisted flow.

```text
gasboost console
      ↓
open provider / project settings UI
      ↓
developer obtains required value
      ↓
developer explicitly configures
Apps Script Script Properties
```

For example, the developer may configure:

```text
FIREBASE_SERVICE_ACCOUNT_EMAIL
FIREBASE_PRIVATE_KEY
```

through Apps Script Project Settings.

This keeps credential ownership explicit and avoids turning the console into a secret-storage system.

## Operation Security

The browser cannot execute arbitrary shell commands.

Console actions are implemented as registered operations with structured input.

```text
browser action
     ↓
registered operation ID
     ↓
validated structured input
     ↓
known implementation
```

The generic runtime and security boundary are provided by `@gasboost/console-runtime`.

## Architecture

```text
@gasboost/cli
      ↓
starts console
      ↓
@gasboost/console
      ↓
registers gasboost-specific operations
      ↓
@gasboost/console-runtime
      ↓
localhost browser transport
```

`@gasboost/console` owns gasboost-specific lifecycle knowledge.

`@gasboost/console-runtime` remains generic.

## License

MIT
