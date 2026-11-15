import type { ProjectFragment } from "../fragment.js";

export function realtimeFragment(): ProjectFragment {
  return {
    files: {
      "src/shared/realtime.ts": `import type { TableDefinition } from "@gasboost/table";

// Only application tables belong here; never include authentication tables.
export const realtimeTables: readonly TableDefinition[] = [];
`,
      "src/backend/lib/credentials.ts": `export function serviceAccount() {
  const properties = PropertiesService.getScriptProperties();
  return {
    email: properties.getProperty("FIREBASE_SERVICE_ACCOUNT_EMAIL") || "",
    privateKey: properties.getProperty("FIREBASE_PRIVATE_KEY") || "",
  };
}
`,
      "src/backend/lib/firebase.ts": `import { FirebaseAuthHook } from "@gasboost/auth-realtime-firebase";
import { serviceAccount } from "./credentials";

export const firebaseAuthHook = new FirebaseAuthHook({ serviceAccount: serviceAccount(), utilities: Utilities });
`,
      "src/backend/lib/rtdb.ts": `import { FirebaseRtdb, FirebaseRtdbRestTransport, PropertiesVersionStore } from "@gasboost/realtime-firebase";
import { serviceAccount } from "./credentials";

// Resolve GAS services when publishing, so the CLI can generate rules in Node.
export const rtdb = new FirebaseRtdb({
  versionStore: {
    next: table => new PropertiesVersionStore(PropertiesService.getScriptProperties()).next(table),
  },
  transport: {
    patch: updates => new FirebaseRtdbRestTransport({
      databaseUrl: PropertiesService.getScriptProperties().getProperty("FIREBASE_DATABASE_URL") || "",
      urlFetchApp: UrlFetchApp,
      cacheService: CacheService,
      credentialsProvider: serviceAccount,
      utilities: Utilities,
    }).patch(updates),
  },
});
`,
      ".env.example": `# Firebase Web App settings (Realtime only)
VITE_FIREBASE_API_KEY=
VITE_FIREBASE_AUTH_DOMAIN=
VITE_FIREBASE_DATABASE_URL=
VITE_FIREBASE_PROJECT_ID=
VITE_FIREBASE_APP_ID=

# Local backend only. Never use a VITE_ prefix for service-account credentials.
FIREBASE_SERVICE_ACCOUNT_EMAIL=
FIREBASE_PRIVATE_KEY=
FIREBASE_DATABASE_URL=
`,
    },
    dependencies: {
      "@gasboost/auth-realtime-firebase": "^0.4.0",
      "@gasboost/realtime-firebase": "^0.9.0",
    },
    devDependencies: {},
    scripts: { rules: "gasboost rtdb rules" },
  };
}
