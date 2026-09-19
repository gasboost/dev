import type { ProjectFragment } from "../fragment.js";

export function databaseFragment({
  authentication,
}: {
  readonly authentication: boolean;
}): ProjectFragment {
  return {
    files: {
      "src/shared/tables.ts": renderSharedTables(authentication),
      "src/backend/lib/db.ts": renderDatabase(authentication),
    },

    dependencies: {
      "@gasboost/sheetorm": "^3.1.0",
      "@gasboost/table": "^0.1.0",
      zod: "^4.6.5",
    },
  };
}

function renderSharedTables(authentication: boolean): string {
  const imports = [
    'import { defineTable } from "@gasboost/table";',
    'import { z } from "zod";',
  ];

  if (authentication) {
    imports.unshift('import { createAuthTables } from "@gasboost/auth";');
  }

  const authTables = authentication
    ? `
export const authTables = createAuthTables();
`
    : "";

  return `${imports.join("\n")}
${authTables}
export const itemsTable = defineTable({
  name: "items",

  schema: z.object({
    id: z.string(),
    ownerId: z.string(),
    value: z.string(),
  }),

  primaryKey: "id",
});
`;
}

function renderDatabase(authentication: boolean): string {
  const sharedImport = authentication
    ? `import { authTables, itemsTable } from "../../shared/tables";`
    : `import { itemsTable } from "../../shared/tables";`;

  const authTableDeclarations = authentication
    ? `
const userTable = new SheetTable({
  ...authTables.user,
  dbId: spreadsheetId,
});

const accountTable = new SheetTable({
  ...authTables.account,
  dbId: spreadsheetId,
});

const passwordResetTable = new SheetTable({
  ...authTables.passwordReset,
  dbId: spreadsheetId,
});
`
    : "";

  const tables = authentication
    ? `const tables = [
  itemsSheetTable,
  userTable,
  accountTable,
  passwordResetTable,
] as const;`
    : `const tables = [
  itemsSheetTable,
] as const;`;

  return `import {
  SheetDB,
  SheetGateway,
  SheetTable,
} from "@gasboost/sheetorm";
${sharedImport}

export const spreadsheetId =
  SpreadsheetApp.getActive().getId();

const itemsSheetTable = new SheetTable({
  ...itemsTable,
  dbId: spreadsheetId,
  autoNumbering: "uuid",
});
${authTableDeclarations}
${tables}

export const db = new SheetDB({
  tables,
  gateway: new SheetGateway(Sheets!),
  cacheService: CacheService,
  utilities: Utilities,
});

export type DB = typeof db;
`;
}
