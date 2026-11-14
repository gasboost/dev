import type { CapabilitySelection } from "../capabilities.js";
import type { ProjectFragment } from "../fragment.js";

export function baseFragment(
  capabilities: CapabilitySelection,
): ProjectFragment {
  return {
    files: {
      ".gitignore":
        "node_modules/\ndist/\n.env\n.env.*\n!.env.example\ncoverage/\n.DS_Store\n",
      "appsscript.json": JSON.stringify(
        {
          timeZone: "Asia/Tokyo",
          ...(capabilities.database
            ? {
                dependencies: {
                  enabledAdvancedServices: [
                    {
                      userSymbol: "Sheets",
                      version: "v4",
                      serviceId: "sheets",
                    },
                  ],
                },
              }
            : {}),
          exceptionLogging: "STACKDRIVER",
          runtimeVersion: "V8",
        },
        null,
        2,
      ),
      "gasboost.config.ts": `import { defineGasboostConfig } from "@gasboost/config";

export default defineGasboostConfig({
  appsScript: { type: "webapp", rootDir: "./dist" },
${capabilities.realtime ? '  firebase: { realtimeDatabase: { source: "./src/backend/lib/rtdb.ts", out: "./database.rules.json" } },' : ""}
});
`,
      "tsconfig.json": JSON.stringify(
        {
          compilerOptions: {
            target: "ES2022",
            lib: ["ES2022", "DOM", "DOM.Iterable"],
            module: "ESNext",
            moduleResolution: "Bundler",
            jsx: "react-jsx",
            strict: true,
            noEmit: true,
            skipLibCheck: true,
            types: ["google-apps-script", "vite/client", "node"],
            resolveJsonModule: true,
            esModuleInterop: true,
            ...(capabilities.frontend
              ? { paths: { "@/*": ["./src/frontend/*"] } }
              : {}),
          },
          include: ["src", "tests", "dev", "*.config.ts"],
        },
        null,
        2,
      ),
      "vitest.config.ts": `import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    environment: "node",
    setupFiles: ["./tests/mocks/runtime.ts"${capabilities.database ? ', "./tests/mocks/db.ts"' : ""}],
    passWithNoTests: true,
  },
});
`,
      "tests/mocks/runtime.ts": renderTestRuntime(capabilities),
      "vite.config.ts": renderVite(capabilities),
      "src/backend/main.ts": renderMain(capabilities),
      ...(capabilities.authentication
        ? { "dev/runtime.ts": renderDevRuntime() }
        : {}),
    },
    dependencies: { "@gasboost/app": "^5.5.0" },
    devDependencies: {
      "@gasboost/cli": "^0.3.12",
      "@gasboost/config": "^0.2.0",
      "@gasboost/vite": "^1.6.1",
      "@gasboost/fake-core": "^0.4.0",
      "@gasboost/fake-node": "^0.3.0",
      "@types/google-apps-script": "^2.0.15",
      "@types/node": "^26.6.6",
      typescript: "^7.0.2",
      vite: "^8.3.6",
      vitest: "^5.1.0",
      "cross-env": "^10.1.0",
    },
    scripts: {
      dev: "vite",
      console: "gasboost console open",
      clean:
        "node -e \"require('node:fs').rmSync('dist',{recursive:true,force:true})\"",
      "build:server": "cross-env BUILD_TARGET=server vite build",
      "build:manifest":
        "node -e \"require('node:fs').copyFileSync('appsscript.json','dist/appsscript.json')\"",
      build: [
        "pnpm clean",
        ...(capabilities.frontend ? ["pnpm build:client"] : []),
        "pnpm build:server",
        "pnpm build:manifest",
        ...(capabilities.realtime ? ["pnpm rules"] : []),
      ].join(" && "),
      typecheck: "tsc --noEmit",
      test: "vitest run --passWithNoTests",
    },
  };
}

function renderMain(capabilities: CapabilitySelection): string {
  return `import { AppsScript, type InferAppsScript } from "@gasboost/app";
${
  capabilities.authentication
    ? `import { authentication, authErrorHandler, handlers } from "@gasboost/auth-app";
import { auth } from "./lib/auth";
import { bootstrap } from "./lib/bootstrap";
${capabilities.frontend ? 'import { templateValue } from "./lib/templateValue";' : ""}`
    : capabilities.database
      ? 'import "./lib/db";'
      : ""
}
${capabilities.realtime ? 'import { firebaseAuthHandlers } from "@gasboost/auth-realtime-firebase";\nimport { firebaseAuthHook } from "./lib/firebase";' : ""}

const app = new AppsScript()
${
  capabilities.frontend
    ? capabilities.authentication
      ? `  .get(request => {
    const template = HtmlService.createTemplateFromFile("index");
    template.__BOOTSTRAP__ = templateValue(bootstrap.handle(request));
    return template.evaluate().setTitle("GAS BOOST");
  })`
      : '  .get(() => HtmlService.createHtmlOutputFromFile("index").setTitle("GAS BOOST"))'
    : capabilities.authentication
      ? `  .get(request => ContentService.createTextOutput(JSON.stringify(bootstrap.handle(request)))
    .setMimeType(ContentService.MimeType.JSON))`
      : ""
}
${
  capabilities.authentication
    ? `  .calls(bootstrap.handlers())
  .use(authErrorHandler())
  .calls(handlers(auth))
  .use(authentication(auth))`
    : ""
}
${capabilities.realtime ? "  .calls(firebaseAuthHandlers(firebaseAuthHook))" : ""};

export default app;
export type AppType = InferAppsScript<typeof app>;
`;
}

function renderTestRuntime(capabilities: CapabilitySelection): string {
  return `import { InMemoryPropertiesService, InMemoryCacheService${capabilities.authentication ? ", InMemoryContext, InMemorySession, SecurityPolicy" : ""} } from "@gasboost/fake-core";
import { NodeLockService, NodeUtilities${capabilities.realtime ? ", NodeUrlFetchApp" : ""} } from "@gasboost/fake-node";
${capabilities.database ? 'import { SpreadsheetAppStub, SheetsStub } from "@gasboost/sheetorm";' : ""}
import { vi } from "vitest";

vi.stubGlobal("PropertiesService", new InMemoryPropertiesService(${capabilities.database ? '{ script: { GASBOOST_SPREADSHEET_ID: "integration-test" } }' : ""}));
vi.stubGlobal("CacheService", new InMemoryCacheService());
vi.stubGlobal("LockService", new NodeLockService({ scriptId: "integration-tests", userId: "test-user" }));
vi.stubGlobal("Utilities", new NodeUtilities());
${
  capabilities.authentication
    ? `vi.stubGlobal("Session", new InMemorySession(new InMemoryContext(
  "", "", { type: "WEB_APP", executeAs: "USER" }, new SecurityPolicy([]), "ja", "Asia/Tokyo",
)));`
    : ""
}
${capabilities.database ? 'vi.stubGlobal("SpreadsheetApp", SpreadsheetAppStub);\nvi.stubGlobal("Sheets", SheetsStub);' : ""}
${capabilities.realtime ? 'vi.stubGlobal("UrlFetchApp", new NodeUrlFetchApp());' : ""}
`;
}

function renderDevRuntime(): string {
  return `import { randomUUID } from "node:crypto";
import { InMemoryPropertiesService, InMemorySession, InMemoryContext, SecurityPolicy, OAuthScope } from "@gasboost/fake-core";
import { NodeLockService } from "@gasboost/fake-node";

// Development-only bootstrap challenge; no production identity or credentials.
const email = process.env.GASBOOST_LOCAL_USER_EMAIL || "developer@localhost.invalid";
const token = randomUUID();
export const properties = new InMemoryPropertiesService({ script: {
  GASBOOST_SPREADSHEET_ID: "local",
  APP_STATE: JSON.stringify({ initialized: false, bootstrap: {
    token, email, expiresAt: Date.now() + 30 * 60_000, attempts: 0, notified: true,
  } }),
} });
export const runtime = {
  PropertiesService: properties,
  LockService: new NodeLockService({ scriptId: "local", userId: email }),
  Session: new InMemorySession(new InMemoryContext(email, email,
    { type: "WEB_APP", executeAs: "USER" }, new SecurityPolicy([OAuthScope.USERINFO_EMAIL]), "ja", "Asia/Tokyo")),
};
export function bootstrapState() {
  const state = JSON.parse(properties.getScriptProperties().getProperty("APP_STATE")!);
  return JSON.stringify({ initialized: state.initialized });
}
export function bootstrapUrl(base: string) {
  return base + "?token=" + encodeURIComponent(token) + "#/bootstrap";
}
`;
}

function renderVite(capabilities: CapabilitySelection): string {
  return `import { defineConfig${capabilities.realtime ? ", loadEnv" : ""}${capabilities.authentication ? ", type Plugin" : ""} } from "vite";
import { gasboost } from "@gasboost/vite";
${capabilities.authentication ? `import { NodeLockService${capabilities.realtime ? ", NodeUrlFetchApp" : ""} } from "@gasboost/fake-node";` : ""}
${capabilities.database ? 'import { SpreadsheetAppStub, SheetsStub } from "@gasboost/sheetorm";\nimport { tables } from "./src/shared/tables";' : ""}
${capabilities.frontend ? 'import react from "@vitejs/plugin-react";\nimport tailwind from "@tailwindcss/vite";\nimport { viteSingleFile } from "vite-plugin-singlefile";\nimport { fileURLToPath } from "node:url";' : ""}

export default defineConfig(async ({ command${capabilities.realtime ? ", mode" : ""} }) => {
  const serving = command === "serve";
${capabilities.authentication ? '  const local = serving ? await import("./dev/runtime") : undefined;' : ""}
${
  capabilities.realtime
    ? `  if (local) {
    const env = loadEnv(mode, process.cwd(), "");
    local.properties.getScriptProperties().setProperties({
      FIREBASE_SERVICE_ACCOUNT_EMAIL: env.FIREBASE_SERVICE_ACCOUNT_EMAIL || "",
      FIREBASE_PRIVATE_KEY: env.FIREBASE_PRIVATE_KEY || "",
      FIREBASE_DATABASE_URL: env.FIREBASE_DATABASE_URL || "",
    });
  }`
    : ""
}
  const { build, dev } = gasboost({
    entry: "src/backend/main.ts",
    localRpc: { override: true${capabilities.database ? ", database: { local: Object.fromEntries(tables.map(table => [table.name, []])) }" : ""} },
${
  capabilities.database
    ? `    runtime: { SpreadsheetApp: SpreadsheetAppStub, Sheets: SheetsStub,
      ${capabilities.authentication ? '...(local?.runtime ?? { LockService: new NodeLockService({ scriptId: "build", userId: "build" }) })' : 'PropertiesService: new InMemoryPropertiesService({ script: { GASBOOST_SPREADSHEET_ID: "local" } }), LockService: new NodeLockService({ scriptId: "local", userId: "local" })'} ${capabilities.realtime ? ", UrlFetchApp: new NodeUrlFetchApp()" : ""} },`
    : ""
}
  });
${
  capabilities.authentication
    ? `  const bootstrap: Plugin = {
    name: "local-bootstrap", apply: "serve",
    transformIndexHtml: { order: "pre", handler: html => html.replace("<?!= __BOOTSTRAP__ ?>", () => local!.bootstrapState()) },
    configureServer(server) {
      server.httpServer?.once("listening", () => {
        const address = server.httpServer!.address();
        if (address && typeof address !== "string") console.log("Local bootstrap: " + local!.bootstrapUrl("http://localhost:" + address.port + "/"));
      });
    },
  };`
    : ""
}
  if (!serving && process.env.BUILD_TARGET === "server") {
    return { plugins: [build], build: { outDir: "dist", emptyOutDir: false } };
  }
${
  capabilities.frontend
    ? `  return {
    resolve: { alias: { "@": fileURLToPath(new URL("./src/frontend", import.meta.url)) } },
    plugins: [react(), tailwind(), viteSingleFile(), ...(serving ? [dev${capabilities.authentication ? ", bootstrap" : ""}] : [])],
    build: { outDir: "dist", emptyOutDir: false },
  };`
    : `  return { plugins: serving ? [dev${capabilities.authentication ? ", bootstrap" : ""}] : [build], build: { outDir: "dist", emptyOutDir: false } };`
}
});
`.replace(
    "import { gasboost }",
    `${capabilities.database && !capabilities.authentication ? 'import { InMemoryPropertiesService } from "@gasboost/fake-core";\nimport { NodeLockService } from "@gasboost/fake-node";\n' : ""}import { gasboost }`,
  );
}
