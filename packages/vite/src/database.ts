import { randomUUID } from "node:crypto";
import type { GasboostOptions } from "./gasboost";

type Database = NonNullable<
  NonNullable<GasboostOptions["localRpc"]>["database"]
>;

// Keep data outside Vite's module runner: it clears its cache on every RPC.
export function createLocalDatabase(database: Database) {
  const key = `gasboost:database:${randomUUID()}`;
  const symbol = Symbol.for(key);

  return {
    install() {
      Object.defineProperty(globalThis, symbol, {
        configurable: true,
        value: {
          seeds: structuredClone(database),
          storage: new Map(),
        },
      });
    },
    dispose() {
      Reflect.deleteProperty(globalThis, symbol);
    },
    moduleSource(moduleId: string) {
      const original = JSON.stringify(moduleId);

      return `
import {
  SheetDB as OriginalSheetDB,
  InMemoryGateway,
  InMemoryDataStore,
} from ${original};
export * from ${original};

const state = globalThis[Symbol.for(${JSON.stringify(key)})];
if (!state) throw new Error("Local RPC database is not available.");
const store = new InMemoryDataStore(state.storage);

export class SheetGateway extends InMemoryGateway {
  constructor(_sheets) {
    super(store);
  }

  initialize(tables) {
    for (const table of tables) {
      const key = table.dbId + ":" + table.name;
      if (state.storage.has(key)) continue;
      const database = state.seeds[table.dbId];
      if (!database || !Object.hasOwn(database, table.name)) {
        throw new Error("Local RPC database table is not configured: " + key);
      }
      const headers = table.schema.keyof().options;
      const rows = database[table.name].map(record =>
        headers.map(column => record[column]),
      );
      store.set(key, [headers, ...rows]);
    }
  }
}

// The gateway cannot see registered schemas. Initialize from the unmodified
// consumer's SheetDB config, before any reads or writes (including at import).
export class SheetDB extends OriginalSheetDB {
  constructor(config) {
    if (config.gateway instanceof SheetGateway) {
      config.gateway.initialize(config.tables);
    }
    super(config);
  }
}
`;
    },
  };
}
