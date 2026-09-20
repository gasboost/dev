import { describe, expect, it } from "vitest";
import {
  CAPABILITY_PROFILES,
  type CapabilitySelection,
} from "../src/capabilities.js";
import { createProjectFiles, type GeneratedFile } from "../src/generator.js";

const profileNames = [
  "backend only",
  "frontend",
  "database",
  "database + frontend",
  "database + authentication",
  "database + authentication + frontend",
  "database + authentication + frontend + realtime",
] as const;

describe("createProjectFiles", () => {
  CAPABILITY_PROFILES.forEach((capabilities, index) => {
    it(`generates ${profileNames[index]}`, () => {
      assertProfile(capabilities);
    });
  });
});

function assertProfile(capabilities: CapabilitySelection): void {
  const generated = createProjectFiles({
    projectName: "example-app",
    capabilities,
  });

  const files = toFileMap(generated);

  assertAlwaysGenerated(files);
  assertPackageScripts(files, capabilities);
  assertDatabase(files, capabilities);
  assertAuthentication(files, capabilities);
  assertFrontend(files, capabilities);
  assertRealtime(files, capabilities);
  assertNoLegacyStarterContent(files);
}

function assertAlwaysGenerated(files: ReadonlyMap<string, string>): void {
  for (const path of [
    "src/backend/main.ts",
    "appsscript.json",
    "vite.config.ts",
    "gasboost.config.ts",
    "tsconfig.json",
    "package.json",
  ]) {
    expect(files.has(path), `${path} should be generated`).toBe(true);
  }

  const main = requiredFile(files, "src/backend/main.ts");

  expect(main).toContain(
    'call("hello", () => ({ message: "Hello from gasboost" }))',
  );

  const packageJson = packageFile(files);

  expect(packageJson.dependencies["@gasboost/app"]).toBe("^5.0.0");

  expect(packageJson.devDependencies["@gasboost/vite"]).toBe("^1.2.2");

  expect(packageJson.devDependencies["@gasboost/cli"]).toBe("^0.3.4");

  expect(packageJson.devDependencies["@gasboost/fake-core"]).toBeUndefined();

  expect(packageJson.devDependencies["@gasboost/fake-node"]).toBeUndefined();
}

function assertPackageScripts(
  files: ReadonlyMap<string, string>,
  capabilities: CapabilitySelection,
): void {
  const packageJson = packageFile(files);

  expect(packageJson.scripts.dev).toBe("vite");

  expect(packageJson.scripts.console).toBe("gasboost console open");

  expect(packageJson.scripts.typecheck).toBe("tsc --noEmit");

  expect(packageJson.scripts.test).toBe("vitest run --passWithNoTests");

  expect(packageJson.scripts.push).toBeUndefined();
  expect(packageJson.scripts["deploy:new"]).toBeUndefined();
  expect(packageJson.scripts["deploy:update"]).toBeUndefined();

  if (capabilities.frontend) {
    expect(packageJson.scripts["build:client"]).toBe(
      "vite build --mode client",
    );
  } else {
    expect(packageJson.scripts["build:client"]).toBeUndefined();
  }

  if (capabilities.realtime) {
    expect(packageJson.scripts.rules).toBe("gasboost rtdb rules");

    expect(packageJson.scripts.build).toContain("pnpm rules");
  } else {
    expect(packageJson.scripts.rules).toBeUndefined();

    expect(packageJson.scripts.build).not.toContain("pnpm rules");
  }
}

function assertDatabase(
  files: ReadonlyMap<string, string>,
  capabilities: CapabilitySelection,
): void {
  const packageJson = packageFile(files);

  expect(files.has("src/backend/lib/db.ts")).toBe(capabilities.database);

  expect(files.has("src/shared/tables.ts")).toBe(capabilities.database);

  if (capabilities.database) {
    expect(packageJson.dependencies["@gasboost/sheetorm"]).toBe("^3.1.0");

    expect(packageJson.dependencies["@gasboost/table"]).toBe("^0.1.0");

    expect(packageJson.dependencies.zod).toBe("^4.6.5");

    const manifest = JSON.parse(requiredFile(files, "appsscript.json")) as {
      dependencies?: {
        enabledAdvancedServices?: unknown[];
      };
    };

    expect(manifest.dependencies?.enabledAdvancedServices).toHaveLength(1);

    const viteConfig = requiredFile(files, "vite.config.ts");

    expect(viteConfig).toContain("SpreadsheetAppStub");

    expect(viteConfig).toContain("SheetsStub");

    const db = requiredFile(files, "src/backend/lib/db.ts");

    expect(db).toContain('getProperty("GASBOOST_SPREADSHEET_ID")');

    expect(db).toContain("function resolveSpreadsheetId()");

    expect(db).toContain("SpreadsheetApp.getActive()?.getId()");
  } else {
    expect(packageJson.dependencies["@gasboost/sheetorm"]).toBeUndefined();

    const manifest = JSON.parse(requiredFile(files, "appsscript.json")) as {
      dependencies?: unknown;
    };

    expect(manifest.dependencies).toBeUndefined();
  }
}

function assertAuthentication(
  files: ReadonlyMap<string, string>,
  capabilities: CapabilitySelection,
): void {
  const packageJson = packageFile(files);

  expect(files.has("src/backend/lib/auth.ts")).toBe(
    capabilities.authentication,
  );

  if (!capabilities.authentication) {
    expect(packageJson.dependencies["@gasboost/auth"]).toBeUndefined();

    return;
  }

  expect(packageJson.dependencies["@gasboost/auth"]).toBe("^0.4.1");

  expect(packageJson.dependencies["@gasboost/auth-app"]).toBe("^0.2.1");

  expect(packageJson.dependencies["@gasboost/auth-sheetorm"]).toBe("^0.2.1");

  const tables = requiredFile(files, "src/shared/tables.ts");

  expect(tables).toContain("createAuthTables");
  expect(tables).toContain("export const authTables");

  const main = requiredFile(files, "src/backend/main.ts");

  const handlersIndex = main.indexOf(".calls(handlers(auth))");

  const helloIndex = main.indexOf('.call("hello"');

  const middlewareIndex = main.indexOf(".use(authentication(auth))");

  expect(handlersIndex).toBeGreaterThan(-1);

  /*
   * Authentication handlers and hello are public.
   */
  expect(helloIndex).toBeGreaterThan(handlersIndex);

  /*
   * Only handlers registered after authentication()
   * should require a session token.
   */
  expect(middlewareIndex).toBeGreaterThan(helloIndex);
}

function assertFrontend(
  files: ReadonlyMap<string, string>,
  capabilities: CapabilitySelection,
): void {
  const packageJson = packageFile(files);

  for (const path of [
    "index.html",
    "src/frontend/main.tsx",
    "src/frontend/App.tsx",
    "src/frontend/lib/appsscript.ts",
  ]) {
    expect(files.has(path), `${path} frontend condition`).toBe(
      capabilities.frontend,
    );
  }

  if (!capabilities.frontend) {
    expect(packageJson.dependencies.react).toBeUndefined();

    expect(packageJson.dependencies["@gasboost/react"]).toBeUndefined();

    return;
  }

  expect(packageJson.dependencies.react).toBe("^19.3.0");

  expect(packageJson.dependencies["react-dom"]).toBe("^19.3.0");

  expect(packageJson.dependencies["@gasboost/client"]).toBe("^0.3.0");

  expect(packageJson.dependencies["@gasboost/react"]).toBe("^0.1.2");

  expect(packageJson.devDependencies["@gasboost/react"]).toBeUndefined();

  const main = requiredFile(files, "src/frontend/main.tsx");

  expect(main).toContain(
    'import { AppsScriptRouter } from "@gasboost/react";',
  );

  expect(main).toContain("<StrictMode>");
  expect(main).toContain("<AppsScriptRouter>");
  expect(main).toContain("<App />");
  expect(main).toContain("</AppsScriptRouter>");

  const app = requiredFile(files, "src/frontend/App.tsx");

  expect(app).toContain("await client.hello()");
}

function assertRealtime(
  files: ReadonlyMap<string, string>,
  capabilities: CapabilitySelection,
): void {
  const packageJson = packageFile(files);

  for (const path of [
    "src/backend/lib/firebase.ts",
    "src/backend/lib/rls.ts",
    "src/backend/lib/rtdb.ts",
    "src/frontend/lib/firebase.ts",
    "src/frontend/lib/replica.ts",
  ]) {
    expect(files.has(path), `${path} realtime condition`).toBe(
      capabilities.realtime,
    );
  }

  const config = requiredFile(files, "gasboost.config.ts");

  if (!capabilities.realtime) {
    expect(config).not.toContain("realtimeDatabase");

    return;
  }

  expect(config).toContain('source: "./src/backend/lib/rtdb.ts"');

  expect(config).toContain('out: "./database.rules.json"');

  expect(packageJson.dependencies["@gasboost/realtime-firebase"]).toBe(
    "^0.3.1",
  );

  expect(packageJson.dependencies["@gasboost/rls"]).toBe("^0.3.1");

  expect(packageJson.dependencies["@gasboost/replica"]).toBe("^0.3.0");

  expect(packageJson.dependencies["@gasboost/auth-realtime-firebase"]).toBe(
    "^0.1.1",
  );

  expect(packageJson.dependencies.firebase).toBe("^12.19.0");

  const rtdb = requiredFile(files, "src/backend/lib/rtdb.ts");

  const replica = requiredFile(files, "src/frontend/lib/replica.ts");

  expect(rtdb).not.toContain("authTables");
  expect(replica).not.toContain("authTables");

  expect(rtdb).toContain("itemsTable");
  expect(replica).toContain("itemsTable");

  const backendFirebase = requiredFile(files, "src/backend/lib/firebase.ts");

  expect(backendFirebase).toContain("FIREBASE_SERVICE_ACCOUNT_EMAIL");

  expect(backendFirebase).toContain("FIREBASE_PRIVATE_KEY");

  expect(backendFirebase).not.toContain("setProperty");
}

function assertNoLegacyStarterContent(
  files: ReadonlyMap<string, string>,
): void {
  const contents = [...files.values()].join("\n");

  expect(contents.toLowerCase()).not.toContain("tutorial");

  expect(contents).not.toContain("AKfy");
  expect(contents).not.toContain("AIzaSy");

  expect(contents).not.toContain("create-gasboost.firebaseapp.com");
}

function toFileMap(
  generated: readonly GeneratedFile[],
): ReadonlyMap<string, string> {
  return new Map(generated.map((file) => [file.path, file.content]));
}

function requiredFile(
  files: ReadonlyMap<string, string>,
  path: string,
): string {
  const content = files.get(path);

  if (content === undefined) {
    throw new Error(`Generated file was not found: ${path}`);
  }

  return content;
}

type GeneratedPackageJson = {
  readonly scripts: Record<string, string | undefined>;

  readonly dependencies: Record<string, string | undefined>;

  readonly devDependencies: Record<string, string | undefined>;
};

function packageFile(files: ReadonlyMap<string, string>): GeneratedPackageJson {
  return JSON.parse(
    requiredFile(files, "package.json"),
  ) as GeneratedPackageJson;
}
