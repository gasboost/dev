import type { ProjectFragment } from "../fragment.js";

export function authFragment({
  realtime,
  frontend,
}: {
  realtime: boolean;
  frontend: boolean;
}): ProjectFragment {
  return {
    files: {
      "src/backend/lib/auth.ts": `import { AppsScriptAuth, AppsScriptAuthorization } from "@gasboost/auth";
import { SheetOrmAuthRepository, SheetOrmAuthorizationRepository } from "@gasboost/auth-sheetorm";
import { policy } from "../../shared/policy";
import { authTables, authorizationTables } from "../../shared/tables";
import { db } from "./db";
${realtime ? 'import { firebaseAuthHook } from "./firebase";' : ""}
export const repository = new SheetOrmAuthRepository({ db, schema: authTables.schema });
export const authorization = new AppsScriptAuthorization({
  policy,
  repository: new SheetOrmAuthorizationRepository({ db, schema: authorizationTables.schema }),
});
export const auth = new AppsScriptAuth({
  repository,
  appsScript: { enabled: true, isSignupEnabled: false },
  runtime: { cacheService: CacheService, propertiesService: PropertiesService, session: Session, utilities: Utilities },
  session: { storageType: "cache" },
  user: { data: async ({ user }) => ({ permissions: await authorization.resolve(user.id) }) },
  ${realtime ? "hooks: { afterSignIn: firebaseAuthHook.afterSignIn }," : ""}
});
`,
      "src/shared/policy.ts": `import { AuthorizationPolicy } from "@gasboost/auth/authorization";

// Define application permissions and role grants when adding business features.
export const policy = new AuthorizationPolicy({});
`,
      "src/backend/lib/bootstrap.ts": `import { AppsScriptBootstrap } from "@gasboost/bootstrap";
import { auth, authorization, repository } from "./auth";
import { db } from "./db";

export const bootstrap = new AppsScriptBootstrap({
  db, auth, authorization, authRepository: repository,
});
`,
      ...(frontend
        ? {
            "src/backend/lib/templateValue.ts": String.raw`import type { BootstrapPublicState } from "@gasboost/bootstrap";

export function templateValue(state: BootstrapPublicState): string {
  return JSON.stringify({ initialized: state.initialized })
    .replace(/</g, "\\u003c")
    .replace(/\u2028/g, "\\u2028")
    .replace(/\u2029/g, "\\u2029");
}
`,
          }
        : {}),
    },
    dependencies: {
      "@gasboost/auth": "^0.12.0",
      "@gasboost/auth-app": "^0.9.0",
      "@gasboost/auth-sheetorm": "^0.5.1",
      "@gasboost/bootstrap": "^0.5.0",
    },
    devDependencies: {},
    scripts: {},
  };
}
