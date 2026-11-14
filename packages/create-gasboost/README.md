# @gasboost/create

Generate a runnable GAS BOOST application skeleton by selecting Database, Authentication, Frontend and Realtime capabilities. Node.js 24+ and pnpm are required. Frontend generation also needs network access for the shadcn CLI, the GAS BOOST GitHub Registry and npm.

```sh
pnpm dlx @gasboost/create my-app
# or: npm create @gasboost -- my-app
cd my-app
pnpm install
pnpm dev
```

The default target is `./gasboost-app`. Existing files are never overwritten by the generator. Frontend installation uses shadcn without `--overwrite`; preserve existing customizations when shadcn asks about a conflict.

The generator creates configuration and connected infrastructure. It does not create business tables, example RPCs, business repositories or tests. Start adding application features directly without deleting a sample application.

## Capabilities and Registry ownership

Authentication requires Database. Realtime requires Database, Authentication and Frontend. Normalization preserves seven profiles:

| Database | Authentication | Frontend | Realtime | Frontend Registry item               |
| -------- | -------------- | -------- | -------- | ------------------------------------ |
| No       | No             | No       | No       | —                                    |
| No       | No             | Yes      | No       | `gasboost/ui/frontend`               |
| Yes      | No             | No       | No       | —                                    |
| Yes      | No             | Yes      | No       | `gasboost/ui/frontend`               |
| Yes      | Yes            | No       | No       | —                                    |
| Yes      | Yes            | Yes      | No       | `gasboost/ui/frontend-auth`          |
| Yes      | Yes            | Yes      | Yes      | `gasboost/ui/frontend-auth-realtime` |

For Frontend, generation executes:

```sh
pnpm dlx shadcn@latest add gasboost/ui/<selected-item> --yes
```

The [GAS BOOST UI Registry](https://github.com/gasboost/ui) owns **all** `src/frontend` sources and `src/shared/routes.ts`, including App, main, styles, authentication UI, guards and providers. Completed frontend items were added in [gasboost/ui#17](https://github.com/gasboost/ui/pull/17). This package only creates `index.html`, `components.json`, TypeScript/Vite aliases, Tailwind configuration and the backend contract. Registry dependencies determine frontend packages and files. There is no frontend template copy in this generator.

A failed Registry installation fails generation with a retry command. The written skeleton remains available; run the reported command from the target directory to complete installation. `createProjectFiles()` is the pure configuration/backend renderer; programmatic users must also call `installFrontend({ targetDirectory, capabilities })` after writing the files.

`@gasboost/react@0.4.3` currently has a transitive `@gasboost/auth-client` dependency. Unauthenticated frontends do not directly install or initialize authentication, but that upstream package remains in the lockfile. `@gasboost/bootstrap@0.5.0` also declares a React peer for its React subpath, so pnpm resolves that peer even for backend-only authentication. The generator does not add frontend sources or a direct React dependency to that profile. Removing these transitive/peer packages requires upstream package changes.

## Generated structure

Database + Authentication + Frontend produces:

```text
my-app/
├── appsscript.json
├── gasboost.config.ts
├── package.json
├── tsconfig.json
├── vite.config.ts
├── vitest.config.ts
├── components.json
├── index.html
├── dev/runtime.ts
├── src/
│   ├── shared/{tables,policy,routes}.ts
│   ├── backend/
│   │   ├── main.ts
│   │   └── lib/{sheets,db,auth,bootstrap,templateValue}.ts
│   └── frontend/                # installed exclusively by the UI Registry
└── tests/mocks/{runtime,db}.ts
```

Unselected capabilities do not create their files or direct dependencies. Database without authentication starts with an empty table list. Authentication adds only the authentication and authorization tables. The policy starts without business permissions or invented business roles; Bootstrap uses the library's default administrator role.

## Development and builds

```sh
pnpm dev
pnpm typecheck
pnpm test
pnpm build
pnpm console
```

Vite `mode` describes the environment. `BUILD_TARGET=server|client` selects the build target via portable `cross-env` scripts; for example, `pnpm build:server --mode staging`. `pnpm build` cleans once, builds the single client HTML when selected, adds the GAS backend without deleting HTML, copies the GAS manifest and generates RTDB rules when selected. Local plugins run only for `command === "serve"`.

Database development uses `localRpc.database` with empty records derived from the real table definitions. It uses the in-memory gateway instead of a remote spreadsheet. Authentication development creates a temporary bootstrap challenge and prints its URL in the terminal. Open that URL to initialize the local database and sign in with the local identity. `GASBOOST_LOCAL_USER_EMAIL` overrides the default development identity. The challenge expires after 30 minutes; restart Vite for a fresh challenge and database. No users or business records are seeded. Authentication-only backend projects can submit the challenge to `initializeApp` through the local RPC endpoint; add a frontend if browser setup is needed.

The local Bootstrap JSON and GAS template both expose only `{ initialized: boolean }`. The bootstrap token belongs in the setup URL, never in the injected JSON.

## Database, authentication and deployment

`gasboost.config.ts` imports `defineGasboostConfig` from the canonical `@gasboost/config` package. Manage Google Apps Script resources with `pnpm console`.

Set `GASBOOST_SPREADSHEET_ID` in GAS Script Properties for Database; container-bound scripts can use the active spreadsheet. `sheets.ts` owns spreadsheet resolution, `sheetTables` and `sheetGateway`. `db.ts` constructs the real `SheetDB` with those exports, CacheService, Utilities and LockService.

Authentication uses Apps Script identities, an authorization repository and `AppsScriptBootstrap`. Public Bootstrap and authentication handlers precede authentication middleware. Register business handlers after that middleware and apply server-side authorization for your application. Self-service signup is disabled; Bootstrap registers the first administrator. Add an explicit provisioning flow if additional users are needed.

For the deployed frontend, use a deployed GAS `/exec` URL. Bootstrap sends the effective user a one-time setup link through MailApp. The active/effective users must match. The backend evaluates the single HTML as a GAS template and safely injects Bootstrap state. Complete initialization before signing in. Without Frontend, the GET handler returns the public Bootstrap state as JSON and still issues the setup email; call `initializeApp` with the emailed token from your Apps Script integration.

## Test foundations

`vitest.config.ts` configures `setupFiles` for `tests/mocks/runtime.ts` and, with Database, `tests/mocks/db.ts`. `pnpm test` succeeds with zero tests. No `*.test.ts` or `*.spec.ts` files are generated.

The runtime uses published `@gasboost/fake-core` and `@gasboost/fake-node` services, plus SheetORM stubs when selected. It does not mock HtmlService. Set Session identity or Script Properties explicitly in your tests when testing authentication.

The database Fake mocks **only** `src/backend/lib/sheets`: `importOriginal` keeps the real generated tables and substitutes an `InMemoryGateway` backed by a store whose headers come from those tables. The real `db.ts`, SheetDB, repositories, handlers and middleware execute unchanged. Test presentation using `app.dispatch(name, input, metadata)` rather than `appsScriptClient` or HtmlService.

## Realtime

Only Realtime adds backend Firebase token issuance, version publishing and rules generation. The Registry provides Firebase Auth synchronization, table notification hooks and the empty Replica. Configure `.env.local` from `.env.example` with Firebase Web App settings. Backend Script Properties are:

- `FIREBASE_SERVICE_ACCOUNT_EMAIL`
- `FIREBASE_PRIVATE_KEY`
- `FIREBASE_DATABASE_URL`

For local development, put the same three backend values in `.env.local` (or the shell environment). Vite loads them for the selected mode into the local PropertiesService. These names must remain unprefixed; only Firebase Web App settings use `VITE_`. Never expose the service-account key to the browser.

No real keys, Firebase project IDs or deployment IDs are generated. An actual Firebase project and valid credentials are required for Firebase sign-in and publication. Local backend/database operations and builds do not require those credentials; signing into a Realtime app does.

The current published `@gasboost/realtime-firebase@0.9.0` stores **version notifications**, not application records. `db.afterCommit` publishes only changes to tables explicitly added to `src/shared/realtime.ts`. This list starts empty and excludes all authentication tables. Add shared application tables to the Registry's frontend Replica and use its `useRtdb` hook to invalidate application queries. Fetch records through authenticated, authorized RPCs; add application RLS policies when defining those tables. A fictitious business RLS policy is not generated.

```sh
pnpm rules
```

Rules deny root reads/writes and allow authenticated reads of version notifications. Never publish authentication or other sensitive records to RTDB. Generated rules must be deployed to your Firebase project before using notifications.

## Generator validation

```sh
pnpm --filter @gasboost/create typecheck
pnpm --filter @gasboost/create test
pnpm --filter @gasboost/create build
pnpm --filter @gasboost/create test:e2e
```

E2E creates all seven profiles with published dependencies, runs the real shadcn CLI for the four frontend profiles, checks strict peers, typecheck, build, zero-test execution, dev module responses and Console startup. Generator-owned temporary tests verify SheetORM writes/reads through the real generated DB with only its gateway replaced, Bootstrap initialization/rejection, authentication and the authenticated Firebase token boundary. Test fixtures are not shipped in generated applications. RTDB rules and token signing are checked locally; real Firebase/GAS credentials, deployment and production access are outside this E2E suite.

## License

MIT
