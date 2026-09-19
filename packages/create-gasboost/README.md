# @gasboost/create

Capability-driven project generator for the gasboost ecosystem.

`@gasboost/create` creates a minimal gasboost project from the capabilities your application actually needs.

Instead of selecting package names directly, you select application capabilities such as Database, Authentication, Frontend, and Realtime. The generator then composes the required gasboost packages, configuration, runtime support, and source files.

## Usage

Create a project with:

```bash
npm create @gasboost -- my-app
```

or:

```bash
pnpm dlx @gasboost/create my-app
```

If the directory is omitted:

```bash
pnpm dlx @gasboost/create
```

the project is created in:

```text
./gasboost-app
```

## Capabilities

The generator asks only about application capabilities.

### Database

Adds Google Sheets persistence using:

```text
@gasboost/sheetorm
@gasboost/table
```

The generated local development runtime also provides the Spreadsheet stubs required to evaluate the backend locally.

### Authentication

Adds authentication using:

```text
@gasboost/auth
@gasboost/auth-app
@gasboost/auth-sheetorm
```

Authentication requires a database.

Therefore:

```text
Authentication => Database
```

If Authentication is enabled, Database is enabled automatically.

### Frontend

Adds a minimal React frontend using:

```text
react
react-dom
@gasboost/client
```

The generated UI contains only the minimum code required to verify communication with the backend through the `hello` RPC.

It is not a tutorial or example business application.

### Realtime

Adds Firebase Realtime Database integration using:

```text
@gasboost/realtime-firebase
@gasboost/auth-realtime-firebase
@gasboost/replica
@gasboost/rls
firebase
```

Realtime requires:

```text
Database
Authentication
Frontend
```

Therefore:

```text
Realtime => Database + Authentication + Frontend
```

Missing capabilities are enabled automatically.

## Generated Profiles

Capability normalization produces seven valid project profiles.

| Database | Authentication | Frontend | Realtime |
| -------- | -------------- | -------- | -------- |
| No       | No             | No       | No       |
| No       | No             | Yes      | No       |
| Yes      | No             | No       | No       |
| Yes      | No             | Yes      | No       |
| Yes      | Yes            | No       | No       |
| Yes      | Yes            | Yes      | No       |
| Yes      | Yes            | Yes      | Yes      |

Invalid combinations are normalized automatically.

For example, selecting Realtime produces:

```text
Database       Yes
Authentication Yes
Frontend       Yes
Realtime       Yes
```

## Generated Project

Every generated project contains a gasboost backend.

```text
.
├── appsscript.json
├── gasboost.config.ts
├── package.json
├── tsconfig.json
├── vite.config.ts
└── src
    └── backend
        └── main.ts
```

The backend always contains a public `hello` RPC.

Additional files are composed according to the selected capabilities.

A project with all capabilities enabled has a structure similar to:

```text
.
├── appsscript.json
├── gasboost.config.ts
├── index.html
├── package.json
├── tsconfig.json
├── vite.config.ts
└── src
    ├── backend
    │   ├── main.ts
    │   └── lib
    │       ├── auth.ts
    │       ├── db.ts
    │       ├── firebase.ts
    │       ├── rls.ts
    │       └── rtdb.ts
    ├── frontend
    │   ├── App.tsx
    │   ├── main.tsx
    │   └── lib
    │       ├── appsscript.ts
    │       ├── firebase.ts
    │       └── replica.ts
    └── shared
        └── tables.ts
```

The exact structure depends on the selected capabilities.

## Development

After generation:

```bash
cd my-app
pnpm install
pnpm dev
```

Build:

```bash
pnpm build
```

Typecheck:

```bash
pnpm typecheck
```

Run tests:

```bash
pnpm test
```

Open the gasboost console:

```bash
pnpm console
```

## Project Definition

Application infrastructure is declared in:

```text
gasboost.config.ts
```

The canonical config API is provided by `@gasboost/config`.

```ts
import { defineGasboostConfig } from "@gasboost/config";

export default defineGasboostConfig({
  appsScript: {
    type: "webapp",
    rootDir: "./dist",
  },
});
```

`gasboost.config.ts` represents the project's Desired State.

When Realtime is enabled, Firebase Realtime Database configuration is added:

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

Credentials and detected remote state do not belong in this file.

## Database

Database projects use SheetORM.

The spreadsheet ID can be supplied through Apps Script Script Properties:

```text
GASBOOST_SPREADSHEET_ID
```

Container-bound projects may fall back to their active spreadsheet.

The local development runtime provides a deterministic Spreadsheet stub so generated projects can run locally without creating a remote spreadsheet first.

## Authentication

Authentication projects add the gasboost authentication infrastructure and SheetORM-backed repository.

Authentication handlers and the starter `hello` RPC are public.

Authentication middleware is installed after those public handlers so application RPCs added after it can require a valid session token.

## Credentials

`@gasboost/create` does not create, register, or modify external credentials.

Firebase service-account credentials are not embedded into generated source code.

For Realtime projects, the backend expects these Apps Script Script Properties:

```text
FIREBASE_SERVICE_ACCOUNT_EMAIL
FIREBASE_PRIVATE_KEY
```

They must be configured explicitly by the developer.

The generator never writes these values to Apps Script Properties Service.

Frontend Firebase configuration is provided using environment variables such as:

```text
VITE_FIREBASE_API_KEY
VITE_FIREBASE_AUTH_DOMAIN
VITE_FIREBASE_DATABASE_URL
VITE_FIREBASE_PROJECT_ID
VITE_FIREBASE_APP_ID
```

No fixed Firebase project ID, API key, deployment ID, or service-account credential is generated.

## Realtime Data

Realtime synchronization is intentionally limited to application data.

Authentication infrastructure is not exposed through Firebase Realtime Database and is not included in the browser replica.

For example:

```text
items
```

can be synchronized while authentication users, accounts, password-reset data, and other authentication infrastructure remain server-side.

Generated Realtime Database access is protected through `@gasboost/rls`.

## Design Principles

`@gasboost/create` follows a few strict rules:

- generate capabilities, not tutorials
- generate only infrastructure selected by the developer
- keep package boundaries explicit
- avoid unused dependencies
- do not embed project-specific credentials
- do not embed deployment identifiers
- do not perform hidden remote configuration
- keep authentication infrastructure server-side
- produce runnable and type-safe projects

The generator provides a clean architectural starting point rather than a sample application that must later be dismantled.

## Validation

The generator itself is validated with:

```bash
pnpm --filter @gasboost/create typecheck
pnpm --filter @gasboost/create test
pnpm --filter @gasboost/create build
pnpm --filter @gasboost/create smoke
```

Generated projects are also tested end-to-end across all seven capability profiles.

The E2E suite verifies:

```text
generate
  ↓
pnpm install
  ↓
pnpm typecheck
  ↓
pnpm build
  ↓
pnpm dev
  ↓
hello RPC
  ↓
pnpm console
```

Frontend profiles additionally verify the frontend response.

Realtime profiles additionally verify Firebase RTDB Security Rules generation.

Run the E2E suite with:

```bash
pnpm --filter @gasboost/create test:e2e
```

## Package

npm:

```text
@gasboost/create
```

Repository:

```text
gasboost/dev
```

Source:

```text
packages/create-gasboost
```

## License

MIT
