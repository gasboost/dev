````markdown
# @gasboost/create

Capability-driven project generator for the Gasboost ecosystem.

`@gasboost/create` creates a minimal Gasboost project from the capabilities your application actually needs.

Instead of choosing from predefined templates, you select application capabilities such as Database, Authentication, Frontend, and Realtime. The generator then composes the required Gasboost packages, configuration, runtime stubs, and source files.

## Usage

Run the initializer with:

```bash
pnpm dlx @gasboost/create my-app
```

or:

```bash
npm create @gasboost -- my-app
```

If the directory is omitted:

```bash
pnpm dlx @gasboost/create
```

the project is created in `./gasboost-app`.

## Capabilities

The generator asks only about application capabilities.

### Database

Adds Google Sheets persistence using:

- `@gasboost/sheetorm`
- `@gasboost/table`

The generated Vite development runtime also provides the Spreadsheet stubs required to evaluate the backend locally.

### Authentication

Adds authentication using:

- `@gasboost/auth`
- `@gasboost/auth-app`
- `@gasboost/auth-sheetorm`

Authentication requires a database, so enabling Authentication automatically enables Database.

### Frontend

Adds a React frontend using:

- React
- `@gasboost/client`
- Vite

The generated frontend can call backend RPC handlers through the Gasboost client.

### Realtime

Adds Firebase Realtime Database integration using:

- `@gasboost/realtime-firebase`
- `@gasboost/auth-realtime-firebase`
- `@gasboost/replica`
- `@gasboost/rls`
- Firebase

Realtime requires:

- Database
- Authentication
- Frontend

Enabling Realtime automatically enables all three.

## Generated profiles

Capability normalization produces seven valid project profiles:

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

## Generated project

Every generated project includes the core Gasboost backend:

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

Additional files are composed according to the selected capabilities.

A project with every capability enabled includes a structure similar to:

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
    │       └── rls.ts
    ├── frontend
    │   ├── App.tsx
    │   ├── main.tsx
    │   └── lib
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

Build the project with:

```bash
pnpm build
```

Run type checking with:

```bash
pnpm typecheck
```

Run tests with:

```bash
pnpm test
```

Open the Gasboost Console with:

```bash
pnpm console
```

## Configuration

Application infrastructure is declared in:

```text
gasboost.config.ts
```

For example, an Apps Script application uses:

```ts
import { defineGasboostConfig } from "@gasboost/cli";

export default defineGasboostConfig({
  appsScript: {
    type: "webapp",
    rootDir: "./dist",
  },
});
```

When Realtime is enabled, Firebase Realtime Database configuration is added as well.

The configuration represents the desired capabilities of the project. Gasboost tooling can inspect it and expose the corresponding project operations.

## Credentials

`@gasboost/create` does not create, register, or modify external credentials.

Firebase service-account credentials are not embedded in generated source code.

For a Realtime project, the backend expects the following Apps Script Script Properties:

```text
FIREBASE_SERVICE_ACCOUNT_EMAIL
FIREBASE_PRIVATE_KEY
```

These credentials must be configured explicitly by the developer.

The generator never writes credentials to Apps Script Properties Service.

Frontend Firebase configuration is supplied through environment variables such as:

```text
VITE_FIREBASE_API_KEY
VITE_FIREBASE_AUTH_DOMAIN
VITE_FIREBASE_DATABASE_URL
VITE_FIREBASE_PROJECT_ID
VITE_FIREBASE_APP_ID
```

No fixed Firebase project ID, API key, deployment ID, or service-account credential is generated.

## Database and authentication

When Database is enabled, the generated application uses SheetORM.

When Authentication is also enabled, authentication tables are added to the same database configuration.

Authentication handlers are registered before authentication middleware so that public authentication operations remain accessible while application RPC handlers can use authentication middleware.

## Realtime data

Realtime synchronization is intentionally limited to application data.

Authentication infrastructure tables are not exposed through Firebase Realtime Database and are not included in the browser replica.

For example:

```text
items
```

may be synchronized, while authentication tables such as users, accounts, and password resets remain server-side.

Generated Realtime Database access is protected using `@gasboost/rls`.

## Design principles

`@gasboost/create` follows a few intentionally strict rules:

- Generate capabilities, not tutorials.
- Generate only the infrastructure selected by the developer.
- Keep application packages loosely coupled.
- Do not embed project-specific credentials or deployment identifiers.
- Do not perform hidden remote configuration.
- Keep authentication infrastructure server-side.
- Make generated projects buildable and type-safe immediately after installation.

The generator is intended to provide a clean architectural starting point rather than a demo application that must later be dismantled.

## Validation

The generator itself is validated with:

```bash
pnpm --filter @gasboost/create typecheck
pnpm --filter @gasboost/create test
pnpm --filter @gasboost/create build
pnpm --filter @gasboost/create smoke
```

Generated projects are also tested end-to-end across all seven supported capability profiles.

The E2E suite generates each profile into a temporary standalone project and verifies:

```text
generate
→ pnpm install
→ pnpm typecheck
→ pnpm build
```

Realtime projects additionally verify Firebase rules generation.

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

Package source:

```text
packages/create-gasboost
```

## License

MIT
````
