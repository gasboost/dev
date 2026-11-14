import type { ProjectFragment } from "../fragment.js";

export function databaseFragment({
  authentication,
  realtime,
}: {
  authentication: boolean;
  realtime: boolean;
}): ProjectFragment {
  return {
    dependencies: {
      "@gasboost/sheetorm": "^4.0.0",
      "@gasboost/table": "^0.2.0",
      zod: "^4.6.7",
    },
    files: {
      "src/shared/tables.ts": authentication
        ? `import { createAuthTables, createAuthorizationTables } from "@gasboost/auth";

export const authTables = createAuthTables();
export const authorizationTables = createAuthorizationTables();
export const tables = [authTables.user, authTables.account, authTables.passwordReset,
  authorizationTables.role, authorizationTables.permission] as const;
`
        : `import type { KeyedTableDefinition } from "@gasboost/table";

// Add shared application table definitions here.
export const tables: readonly KeyedTableDefinition[] = [];
`,
      "src/backend/lib/sheets.ts": `import { SheetGateway, SheetTable } from "@gasboost/sheetorm";
${authentication ? 'import { authTables, authorizationTables } from "../../shared/tables";' : 'import { tables } from "../../shared/tables";'}

function resolveSpreadsheetId(): string {
  const configured = PropertiesService.getScriptProperties().getProperty("GASBOOST_SPREADSHEET_ID");
  const id = configured || SpreadsheetApp.getActive()?.getId();
  if (!id) throw new Error("Set GASBOOST_SPREADSHEET_ID in Script Properties.");
  return id;
}
export const spreadsheetId = resolveSpreadsheetId();
export const sheetTables = ${
        authentication
          ? `[
  new SheetTable({ ...authTables.user, dbId: spreadsheetId }),
  new SheetTable({ ...authTables.account, dbId: spreadsheetId }),
  new SheetTable({ ...authTables.passwordReset, dbId: spreadsheetId }),
  new SheetTable({ ...authorizationTables.role, dbId: spreadsheetId }),
  new SheetTable({ ...authorizationTables.permission, dbId: spreadsheetId }),
] as const`
          : "tables.map(table => new SheetTable({ ...table, dbId: spreadsheetId }))"
      };
export const sheetGateway = new SheetGateway(Sheets!);
`,
      "src/backend/lib/db.ts": `import { SheetDB } from "@gasboost/sheetorm";
import { sheetTables, sheetGateway } from "./sheets";
${realtime ? 'import { rtdb } from "./rtdb";\nimport { realtimeTables } from "../../shared/realtime";' : ""}

export const db = new SheetDB({
  tables: sheetTables,
  gateway: sheetGateway,
  cacheService: CacheService,
  utilities: Utilities,
  lockService: LockService,
${realtime ? "  afterCommit: changes => rtdb.publish(changes.filter(change => realtimeTables.some(table => table.name === change.table))),\n" : ""}});
export type DB = typeof db;
`,
      "tests/mocks/db.ts": `import { vi } from "vitest";

vi.mock("../../src/backend/lib/sheets", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../../src/backend/lib/sheets")>();
  const { InMemoryDataStore, InMemoryGateway } = await import("@gasboost/sheetorm");
  const store = new InMemoryDataStore(new Map(actual.sheetTables.map(table => [
    table.dbId + ":" + table.name, [Object.keys(table.schema.shape)],
  ])));
  return { ...actual, sheetGateway: new InMemoryGateway(store) };
});
`,
    },
  };
}
