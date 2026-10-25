import { chromium } from "@playwright/test";
import {
  InMemoryCacheService,
  InMemoryPropertiesService,
} from "@gasboost/fake-core";
import { NodeUrlFetchApp } from "@gasboost/fake-node";
import { generateKeyPairSync, sign } from "node:crypto";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { resolve } from "node:path";
import { expect, test, vi } from "vitest";
import { createServer } from "vite";
import { gasboost } from "../../src";

const root = resolve(import.meta.dirname, "../fixtures/firebase-emulator");
const project = "demo-gasboost";
const { emulators } = JSON.parse(
  await readFile(resolve(root, "firebase.json"), "utf8"),
);
const endpoint = (name: "auth" | "database") =>
  `${emulators[name].host}:${emulators[name].port}`;

// Auth Emulator accepts this synthetic service account's custom JWT. No real
// credentials or signing keys are used, and the token is sent only to localhost.
function customToken(uid: string, claims: Record<string, unknown> = {}) {
  const { privateKey } = generateKeyPairSync("rsa", { modulusLength: 2048 });
  const now = Math.floor(Date.now() / 1000);
  const account = `e2e@${project}.iam.gserviceaccount.com`;
  const header = Buffer.from(
    JSON.stringify({ alg: "RS256", typ: "JWT" }),
  ).toString("base64url");
  const payload = Buffer.from(
    JSON.stringify({
      iss: account,
      sub: account,
      aud: "https://identitytoolkit.googleapis.com/google.identity.identitytoolkit.v1.IdentityToolkit",
      iat: now,
      exp: now + 3600,
      uid,
      claims,
    }),
  ).toString("base64url");
  const unsigned = `${header}.${payload}`;
  return `${unsigned}.${sign("RSA-SHA256", Buffer.from(unsigned), privateKey).toString("base64url")}`;
}

test("real Auth token + RTDB Rules + Backend root PATCH + authenticated Browser onValue", async () => {
  // Fail if invoked outside emulators:exec; never silently skip this acceptance test.
  expect(process.env.FIREBASE_AUTH_EMULATOR_HOST).toBe(endpoint("auth"));
  expect(process.env.FIREBASE_DATABASE_EMULATOR_HOST).toBe(
    endpoint("database"),
  );
  const databaseUrl = `http://${endpoint("database")}/.json?ns=${project}`;
  const reset = await fetch(databaseUrl, {
    method: "DELETE",
    headers: { Authorization: "Bearer owner" },
  });
  expect(reset.ok).toBe(true);

  const cacheDir = await mkdtemp(resolve(tmpdir(), "gasboost-real-emulator-"));
  const urlFetchApp = new NodeUrlFetchApp();
  const patch = vi.spyOn(urlFetchApp, "fetch"); // call-through to the real Emulator
  const { dev } = gasboost({
    entry: resolve(root, "../rtdb/main.ts"),
    localRpc: {
      database: { primary: { employees: [] } },
      rtdb: { emulator: { namespace: project, ...emulators.database } },
      auth: { emulator: emulators.auth },
    },
    runtime: {
      PropertiesService: new InMemoryPropertiesService(),
      CacheService: new InMemoryCacheService(),
      UrlFetchApp: urlFetchApp,
    },
  });
  const server = await createServer({
    root,
    cacheDir,
    configFile: false,
    logLevel: "silent",
    plugins: [dev],
    server: { host: "127.0.0.1", port: 0 },
  });
  let browser: Awaited<ReturnType<typeof chromium.launch>> | undefined;
  try {
    await server.listen();
    const url = server.resolvedUrls!.local[0];
    browser = await chromium.launch({ headless: true });
    const page = await browser.newPage();
    const pageErrors: string[] = [];
    page.on("pageerror", (error) => pageErrors.push(error.message));
    const authRequests: string[] = [];
    const databaseSockets: string[] = [];
    const externalRequests: string[] = [];
    page.on("request", (request) => {
      const origin = new URL(request.url()).origin;
      if (
        ![
          new URL(url).origin,
          `http://${endpoint("auth")}`,
          `http://${endpoint("database")}`,
        ].includes(origin)
      ) {
        externalRequests.push(request.url());
      }
      if (request.url().includes("signInWithCustomToken"))
        authRequests.push(request.url());
    });
    page.on("websocket", (socket) => {
      if (!socket.url().includes("vite")) databaseSockets.push(socket.url());
    });
    // Observation only: no route(), fulfill(), routeWebSocket(), or SDK stubs.
    await page.goto(url);
    await page.waitForFunction(() => "emulatorE2e" in window);
    await expect(
      page.evaluate(() => (window as any).emulatorE2e.read()),
    ).rejects.toThrow(/permission_denied/i);
    expect(
      await page.evaluate(
        (token) => (window as any).emulatorE2e.signIn(token),
        customToken("e2e-denied"),
      ),
    ).toBe("e2e-denied");
    await expect(
      page.evaluate(() => (window as any).emulatorE2e.read()),
    ).rejects.toThrow(/permission_denied/i);
    expect(
      await page.evaluate(
        (token) => (window as any).emulatorE2e.signIn(token),
        customToken("e2e-reader", { reader: true }),
      ),
    ).toBe("e2e-reader");
    await expect(
      page.evaluate(() => (window as any).emulatorE2e.write()),
    ).rejects.toThrow(/permission_denied/i);
    await page.evaluate(() => (window as any).emulatorE2e.watch());
    await page.waitForFunction(
      () => (window as any).emulatorE2e.values.length > 0,
    );
    expect(
      await page.evaluate(() => (window as any).emulatorE2e.values),
    ).toEqual([null]);

    for (const version of [1, 2]) {
      const employee = { id: `e-${version}`, name: `Employee ${version}` };
      const response = await fetch(`${url}__gasboost/createEmployee`, {
        method: "POST",
        body: JSON.stringify({ input: employee }),
      });
      expect(response.status).toBe(200);
      expect(await response.json()).toEqual([employee]);
      await page.waitForFunction(
        (version) => (window as any).emulatorE2e.values.includes(version),
        version,
      );
    }
    expect(patch.mock.calls).toHaveLength(2);
    patch.mock.calls.forEach(([target, options], index) => {
      expect(target).toBe(databaseUrl);
      expect(options).toMatchObject({
        method: "patch",
        headers: { Authorization: "Bearer owner" },
      });
      expect(JSON.parse(String(options!.payload))).toEqual({
        "syncVersions/employees": index + 1,
      });
    });
    expect(
      await page.evaluate(() => (window as any).emulatorE2e.values),
    ).toEqual([null, 1, 2]);
    expect(
      await page.evaluate(() => (window as any).emulatorE2e.errors),
    ).toEqual([]);
    expect(pageErrors).toEqual([]);
    expect(externalRequests).toEqual([]);
    expect(authRequests).toHaveLength(2);
    expect(
      authRequests.every((target) =>
        target.startsWith(`http://${endpoint("auth")}/`),
      ),
    ).toBe(true);
    expect(
      databaseSockets.some(
        (target) =>
          target.startsWith(`ws://${endpoint("database")}/`) &&
          target.includes(`ns=${project}`),
      ),
    ).toBe(true);
    const optimized = JSON.parse(
      await readFile(resolve(cacheDir, "deps/_metadata.json"), "utf8"),
    );
    expect(Object.keys(optimized.optimized).length).toBeGreaterThan(0);
  } finally {
    await browser?.close();
    await server.close();
    patch.mockRestore();
    await rm(cacheDir, { recursive: true, force: true });
  }
});
