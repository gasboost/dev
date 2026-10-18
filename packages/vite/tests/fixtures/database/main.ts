import { AppsScript } from "@gasboost/app";
import {
  InMemoryGateway,
  InMemoryDataStore,
  SheetDB,
  SheetGateway,
  SheetTable,
} from "@gasboost/sheetorm";
import { z } from "zod";

const users = new SheetTable({
  dbId: "primary",
  name: "users",
  primaryKey: "id",
  schema: z.object({ id: z.string(), name: z.string(), enabled: z.boolean() }),
});
const products = new SheetTable({
  dbId: "primary",
  name: "products",
  primaryKey: "id",
  schema: z.object({ id: z.string(), name: z.string(), price: z.number() }),
});
const otherUsers = new SheetTable({
  dbId: "secondary",
  name: "users",
  primaryKey: "id",
  schema: z.object({ id: z.string(), name: z.string(), enabled: z.boolean() }),
});
const gateway = new SheetGateway(Sheets!);
const db = new SheetDB({
  tables: [users, products] as const,
  gateway,
  cacheService: CacheService,
  utilities: Utilities,
});
const other = new SheetDB({
  tables: [otherUsers] as const,
  gateway: new SheetGateway(Sheets!),
  cacheService: CacheService,
  utilities: Utilities,
});
const custom = new SheetDB({
  tables: [users] as const,
  gateway: new InMemoryGateway(
    new InMemoryDataStore(
      new Map([["primary:users", [["id", "name", "enabled"]]]]),
    ),
  ),
  cacheService: CacheService,
  utilities: Utilities,
});

export default new AppsScript()
  .call("create", (input: { id: string; name: string; enabled: boolean }) =>
    db.table("users").create([input]),
  )
  .call("users", () => db.table("users").find())
  .call("products", () => db.table("products").find())
  .call("otherUsers", () => other.table("users").find())
  .call("custom", () => custom.table("users").find())
  .call("update", (input: { id: string; name: string; enabled: boolean }) =>
    db.table("users").update([input]),
  )
  .call("remove", (id: string) => db.table("users").delete([id]))
  .call("readMany", () =>
    Array.from(
      gateway.readMany([
        { dbId: "primary", sheetName: "users" },
        { dbId: "secondary", sheetName: "users" },
      ]),
    ),
  )
  .call("many", () => db.findMany(["users", "products"]))
  .call("memory", () => gateway instanceof InMemoryGateway);
