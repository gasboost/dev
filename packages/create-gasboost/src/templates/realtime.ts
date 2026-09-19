import type { ProjectFragment } from "../fragment.js";

export function realtimeFragment({
  projectName,
}: {
  readonly projectName: string;
}): ProjectFragment {
  return {
    files: {
      "src/backend/lib/firebase.ts": renderBackendFirebase(),
      "src/backend/lib/rls.ts": renderRls(),
      "src/backend/lib/rtdb.ts": renderRtdb(),
      "src/frontend/lib/firebase.ts": renderFrontendFirebase(),
      "src/frontend/lib/replica.ts": renderReplica(projectName),
    },

    dependencies: {
      "@gasboost/auth-realtime-firebase": "^0.1.1",
      "@gasboost/realtime-firebase": "^0.3.1",
      "@gasboost/replica": "^0.3.0",
      "@gasboost/rls": "^0.3.1",
      firebase: "^12.19.0",
    },

    scripts: {
      rules: "gasboost rtdb rules",
    },
  };
}

function renderBackendFirebase(): string {
  return `import { FirebaseAuthHook } from "@gasboost/auth-realtime-firebase";

const properties =
  PropertiesService.getScriptProperties();

export const firebaseAuthHook =
  new FirebaseAuthHook({
    serviceAccount: {
      email: properties.getProperty(
        "FIREBASE_SERVICE_ACCOUNT_EMAIL",
      )!,
      privateKey: properties.getProperty(
        "FIREBASE_PRIVATE_KEY",
      )!,
    },

    utilities: Utilities,
  });
`;
}

function renderRls(): string {
  return `import {
  column,
  eq,
  principal,
  RowLevelSecurity,
} from "@gasboost/rls";
import { z } from "zod";
import { itemsTable } from "../../shared/tables";

export const principalSchema = z.object({
  userId: z.string(),
});

const ownsItem = eq(
  column(itemsTable, "ownerId"),
  principal(principalSchema, "userId"),
);

export const itemsRls = new RowLevelSecurity({
  table: itemsTable,

  select: {
    using: ownsItem,
  },

  insert: {
    check: ownsItem,
  },

  update: {
    using: ownsItem,
    check: ownsItem,
  },

  delete: {
    using: ownsItem,
  },
});
`;
}

function renderRtdb(): string {
  return `import { FirebaseRtdb } from "@gasboost/realtime-firebase";
import { itemsTable } from "../../shared/tables";
import { itemsRls } from "./rls";

export const rtdb = FirebaseRtdb.generate({
  tables: [
    itemsTable,
  ] as const,

  rowLevelSecurity: [
    itemsRls,
  ],

  principal: {
    userId: "auth.uid",
  },
});
`;
}

function renderFrontendFirebase(): string {
  return `import { initializeApp } from "firebase/app";
import { getAuth } from "firebase/auth";
import { getDatabase } from "firebase/database";

const firebaseApp = initializeApp({
  apiKey: import.meta.env.VITE_FIREBASE_API_KEY,
  authDomain:
    import.meta.env.VITE_FIREBASE_AUTH_DOMAIN,
  databaseURL:
    import.meta.env.VITE_FIREBASE_DATABASE_URL,
  projectId:
    import.meta.env.VITE_FIREBASE_PROJECT_ID,
  appId: import.meta.env.VITE_FIREBASE_APP_ID,
});

export const firebaseAuth =
  getAuth(firebaseApp);

export const firebaseDatabase =
  getDatabase(firebaseApp);
`;
}

function renderReplica(projectName: string): string {
  return `import { createReplica } from "@gasboost/replica";
import { itemsTable } from "../../shared/tables";

export const replica = createReplica({
  name: ${JSON.stringify(`${projectName}-replica`)},

  tables: [
    itemsTable,
  ] as const,
});
`;
}
