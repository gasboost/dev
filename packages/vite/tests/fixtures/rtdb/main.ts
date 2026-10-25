import { AppsScript } from "@gasboost/app";
import {
  FirebaseRtdb,
  FirebaseRtdbRestTransport,
  FirebaseCustomToken,
  PropertiesVersionStore,
} from "@gasboost/realtime-firebase";
import { versionPath } from "@gasboost/realtime-firebase/client";
import { SheetDB, SheetGateway, SheetTable } from "@gasboost/sheetorm";
import { z } from "zod";

export {
  FirebaseRtdb,
  FirebaseCustomToken,
  PropertiesVersionStore,
  versionPath,
};

const employees = new SheetTable({
  dbId: "primary",
  name: "employees",
  primaryKey: "id",
  schema: z.object({ id: z.string(), name: z.string() }),
});
const properties = PropertiesService.getScriptProperties();
const rtdb = new FirebaseRtdb({
  versionStore: new PropertiesVersionStore(properties),
  transport: new FirebaseRtdbRestTransport({
    databaseUrl: "https://production.invalid",
    urlFetchApp: UrlFetchApp,
    cacheService: CacheService,
    credentialsProvider: () => {
      throw new Error("Production credentials were accessed");
    },
  }),
});
const db = new SheetDB({
  tables: [employees] as const,
  gateway: new SheetGateway(Sheets!),
  cacheService: CacheService,
  utilities: Utilities,
  afterCommit: (changes) => rtdb.publish(changes),
});

export default new AppsScript()
  .call("createEmployee", (input: { id: string; name: string }) =>
    db.table("employees").create([input]),
  )
  .call("listEmployees", () => db.table("employees").find())
  .call("publishOnly", () => {
    rtdb.publish([{ table: "employees" }]);
    return true;
  });
