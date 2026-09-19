import type { ProjectFragment } from "../fragment.js";

export function authFragment({
  realtime,
}: {
  readonly realtime: boolean;
}): ProjectFragment {
  return {
    files: {
      "src/backend/lib/auth.ts": renderAuth(realtime),
    },

    dependencies: {
      "@gasboost/auth": "^0.4.1",
      "@gasboost/auth-app": "^0.2.1",
      "@gasboost/auth-sheetorm": "^0.2.1",
    },
  };
}

function renderAuth(realtime: boolean): string {
  const firebaseImport = realtime
    ? `import { firebaseAuthHook } from "./firebase";\n`
    : "";

  const hooks = realtime
    ? `

  hooks: {
    afterSignIn: firebaseAuthHook.afterSignIn,
  },`
    : "";

  return `import { AppsScriptAuth } from "@gasboost/auth";
import { SheetOrmAuthRepository } from "@gasboost/auth-sheetorm";
import { authTables } from "../../shared/tables";
import { db } from "./db";
${firebaseImport}
const repository = new SheetOrmAuthRepository({
  db,
  schema: authTables.schema,
});

export const auth = new AppsScriptAuth({
  repository,

  appsScript: {
    enabled: true,
    isSignupEnabled: true,
  },

  runtime: {
    cacheService: CacheService,
    propertiesService: PropertiesService,
    session: Session,
    utilities: Utilities,
  },

  session: {
    storageType: "cache",
  },${hooks}
});
`;
}
