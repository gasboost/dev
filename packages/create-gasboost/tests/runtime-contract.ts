import type { CapabilitySelection } from "../src/capabilities.js";

// Fixtures belong to the generator's E2E, never to the generated application.
export function runtimeContract(capabilities: CapabilitySelection): string {
  return `import { expect, it, vi } from "vitest";
${
  capabilities.authentication
    ? `import { InMemorySession, InMemoryContext, SecurityPolicy, OAuthScope } from "@gasboost/fake-core";
import { generateKeyPairSync } from "node:crypto";`
    : ""
}

it("executes the real generated foundations", async () => {
${
  capabilities.authentication
    ? `  vi.stubGlobal("Session", new InMemorySession(new InMemoryContext(
    "admin@example.test", "admin@example.test", { type: "WEB_APP", executeAs: "USER" },
    new SecurityPolicy([OAuthScope.USERINFO_EMAIL]), "ja", "Asia/Tokyo")));
  const properties = PropertiesService.getScriptProperties();
  properties.setProperty("APP_STATE", JSON.stringify({ initialized: false, bootstrap: {
    token: "integration-challenge", email: "admin@example.test", expiresAt: Date.now() + 60_000, attempts: 0, notified: true,
  } }));
${
  capabilities.realtime
    ? `  const keys = generateKeyPairSync("rsa", { modulusLength: 2048 });
  properties.setProperty("FIREBASE_SERVICE_ACCOUNT_EMAIL", "test@example.test");
  properties.setProperty("FIREBASE_PRIVATE_KEY", keys.privateKey.export({ type: "pkcs8", format: "pem" }).toString());`
    : ""
}`
    : ""
}
  const { default: app } = await import("../src/backend/main");
${
  capabilities.database
    ? `  const { db } = await import("../src/backend/lib/db");
  const { sheetGateway } = await import("../src/backend/lib/sheets");
  const { InMemoryGateway, SheetDB } = await import("@gasboost/sheetorm");
  expect(sheetGateway).toBeInstanceOf(InMemoryGateway);
  expect(db).toBeInstanceOf(SheetDB);`
    : ""
}
${
  capabilities.database && !capabilities.authentication
    ? `  db.table("fixture").create([{ id: "1", value: "before" }]);
  expect(db.table("fixture").find()).toEqual([{ id: "1", value: "before" }]);
  db.table("fixture").update([{ id: "1", value: "after" }]);
  expect(db.table("fixture").find()).toEqual([{ id: "1", value: "after" }]);
  db.table("fixture").delete(["1"]);
  expect(db.table("fixture").find()).toEqual([]);`
    : ""
}
${
  capabilities.authentication
    ? `  await expect(app.dispatch("initializeApp", { token: "wrong" })).rejects.toThrow("INVALID_TOKEN");
  const initialized = await app.dispatch("initializeApp", { token: "integration-challenge" });
  expect(JSON.parse(initialized.contents)).toEqual({ initialized: true });
  expect(JSON.parse(properties.getProperty("APP_STATE")!)).toEqual({ initialized: true });
  await expect(app.dispatch("initializeApp", { token: "integration-challenge" })).rejects.toThrow("ALREADY_INITIALIZED");
  const signIn = JSON.parse((await app.dispatch("signInAppsScript", {})).contents);
  expect(signIn.session.userId).toBeTruthy();
  const { repository } = await import("../src/backend/lib/auth");
  const user = await repository.user.find(signIn.session.userId);
  expect(user?.name).toBeTruthy();
${
  capabilities.realtime
    ? `  await expect(app.dispatch("issueFirebaseCustomToken", undefined)).rejects.toThrow();
  const token = JSON.parse((await app.dispatch("issueFirebaseCustomToken", undefined,
    { "@gasboost/auth": { token: signIn.session.id } })).contents).customToken;
  expect(JSON.parse(Buffer.from(token.split(".")[1], "base64url").toString()).uid).toBe(signIn.session.userId);
  const { rtdb } = await import("../src/backend/lib/rtdb");
  expect(rtdb.rules().rules[".read"]).toBe(false);`
    : ""
}`
    : ""
}
${
  capabilities.authentication
    ? `  await app.dispatch("signOut", { sessionId: signIn.session.id });
  expect(JSON.parse((await app.dispatch("getSession", { sessionId: signIn.session.id })).contents)).toBeNull();`
    : ""
}
});
`;
}
