import { chromium, type Browser, type BrowserContext } from "@playwright/test";
import { createRequire } from "node:module";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, resolve } from "node:path";
import { afterAll, afterEach, beforeAll, describe, expect, test } from "vitest";
import { build, createServer, type ViteDevServer } from "vite";
import { gasboost, type GasboostOptions } from "../src";
import { getBuildOutputs } from "./helper";

const root = resolve(import.meta.dirname, "fixtures/firebase-browser");
const firebase = dirname(
  createRequire(import.meta.url).resolve("firebase/package.json"),
);
const both = {
  auth: { emulator: {} },
  rtdb: { emulator: { namespace: "demo-gasboost" } },
};
let browser: Browser;
const servers: ViteDevServer[] = [];
const contexts: BrowserContext[] = [];
const caches: string[] = [];
beforeAll(async () => {
  browser = await chromium.launch({ headless: true });
});
afterEach(async () => {
  await Promise.all(contexts.splice(0).map((context) => context.close()));
  await Promise.all(servers.splice(0).map((server) => server.close()));
  await Promise.all(
    caches
      .splice(0)
      .map((cache) => rm(cache, { recursive: true, force: true })),
  );
});
afterAll(async () => {
  await browser?.close();
});

function plugins(localRpc?: GasboostOptions["localRpc"]) {
  return [
    gasboost({ entry: "unused.ts", localRpc }).dev,
    {
      name: "fixture-original-sdk",
      resolveId(id: string) {
        if (id === "fixture:original-auth")
          return resolve(firebase, "auth/dist/esm/index.esm.js");
        if (id === "fixture:original-database")
          return resolve(firebase, "database/dist/esm/index.esm.js");
      },
    },
  ];
}

async function start(
  localRpc?: GasboostOptions["localRpc"],
  mode = "development",
  available = true,
) {
  const cacheDir = await mkdtemp(resolve(tmpdir(), "gasboost-firebase-"));
  caches.push(cacheDir);
  const server = await createServer({
    root,
    cacheDir,
    configFile: false,
    logLevel: "silent",
    mode,
    plugins: plugins(localRpc),
    server: { host: "127.0.0.1", port: 0 },
  });
  servers.push(server);
  await server.listen();
  const url = server.resolvedUrls!.local[0];
  const context = await browser.newContext();
  contexts.push(context);
  const unexpected: string[] = [];
  const authRequests: string[] = [];
  await context.route("**/*", async (route) => {
    const target = route.request().url();
    if (target.startsWith(url)) return route.continue();
    if (target.startsWith("http://127.0.0.1:9099/")) {
      authRequests.push(target);
      if (!available) return route.abort();
      if (route.request().method() === "OPTIONS")
        return route.fulfill({
          headers: {
            "access-control-allow-origin": "*",
            "access-control-allow-headers": "*",
          },
        });
      const payload = Buffer.from(
        JSON.stringify({
          sub: "test-user",
          aud: "demo-gasboost",
          iat: Math.floor(Date.now() / 1000),
          exp: Math.floor(Date.now() / 1000) + 3600,
        }),
      ).toString("base64url");
      return route.fulfill({
        contentType: "application/json",
        headers: { "access-control-allow-origin": "*" },
        body: JSON.stringify({
          localId: "test-user",
          idToken: `e30.${payload}.signature`,
          refreshToken: "test-refresh",
          expiresIn: "3600",
          users: [{ localId: "test-user" }],
        }),
      });
    }
    unexpected.push(target);
    return route.abort();
  });
  const sockets: string[] = [];
  await context.routeWebSocket(/ws:\/\/127\.0\.0\.1:9000\//, (socket) => {
    sockets.push(socket.url());
    if (!available) return socket.close();
    socket.send(
      JSON.stringify({
        t: "c",
        d: {
          t: "h",
          d: { ts: Date.now(), v: "5", h: "127.0.0.1:9000", s: "fixture" },
        },
      }),
    );
    socket.onMessage((message) => {
      const frame = JSON.parse(String(message));
      if (frame.t !== "d") return;
      const request = frame.d;
      if (request.a === "q")
        socket.send(
          JSON.stringify({
            t: "d",
            d: { a: "d", b: { p: request.b.p, d: { value: 42 } } },
          }),
        );
      socket.send(
        JSON.stringify({
          t: "d",
          d: { r: request.r, b: { s: "ok", d: null } },
        }),
      );
    });
  });
  const page = await context.newPage();
  const errors: string[] = [];
  page.on("pageerror", (error) => errors.push(error.message));
  await page.goto(url);
  await page.waitForFunction(() => "fixture" in window);
  return { server, page, errors, unexpected, authRequests, sockets, cacheDir };
}

describe("Firebase SDK in a real Vite browser with dependency optimization", () => {
  test("preserves instances/exports and routes custom-token auth and onValue to emulators", async () => {
    const result = await start(both, "staging");
    expect(
      await result.page.evaluate(() => {
        const f = (window as any).fixture;
        return {
          identity: f.identity,
          exports: f.exports,
          options: f.app.options,
          auth: f.firebaseAuth.emulatorConfig,
          secondAuth: f.initialized.emulatorConfig,
        };
      }),
    ).toMatchObject({
      identity: true,
      exports: true,
      options: { databaseURL: "https://demo-gasboost.firebaseio.com" },
      auth: { host: "127.0.0.1", port: 9099 },
      secondAuth: { port: 9099 },
    });
    expect(
      await result.page.evaluate(() => (window as any).fixture.signIn()),
    ).toBe("test-user");
    expect(
      await result.page.evaluate(() => (window as any).fixture.value()),
    ).toEqual({ value: 42 });
    expect(
      result.authRequests.some((url) => url.includes("signInWithCustomToken")),
    ).toBe(true);
    expect(result.sockets[0]).toContain("ns=demo-gasboost");
    expect(result.unexpected).toEqual([]);
    expect(result.errors).toEqual([]);
    expect(
      await result.page.evaluate(() => (window as any).fixture.explicitUrl()),
    ).toBe(true);
    const metadata = JSON.parse(
      await readFile(resolve(result.cacheDir, "deps/_metadata.json"), "utf8"),
    );
    expect(Object.keys(metadata.optimized).length).toBeGreaterThan(0);
    expect(metadata.optimized["firebase/auth"]).toBeUndefined();
    expect(metadata.optimized["firebase/database"]).toBeUndefined();
    await expect(
      result.page.evaluate(() => (window as any).fixture.mismatch()),
    ).rejects.toThrow("namespace mismatch");
  }, 30000);

  test("unavailable emulators never fall back to production", async () => {
    const result = await start(both, "development", false);
    const failure = await result.page.evaluate(async () => {
      try {
        await (window as any).fixture.signIn();
      } catch (error) {
        return (error as Error).message;
      }
    });
    expect(failure).toContain("auth/network-request-failed");
    await result.page.evaluate(() => {
      void (window as any).fixture.value();
    });
    await expect.poll(() => result.sockets.length).toBeGreaterThan(0);
    expect(result.authRequests.length).toBeGreaterThan(0);
    expect(result.unexpected).toEqual([]);
  }, 30000);

  test("late SDK initialization errors are propagated", async () => {
    const { page } = await start(both);
    await expect(
      page.evaluate(() => (window as any).fixture.lateAuth()),
    ).rejects.toThrow("auth/emulator-config-failed");
    await expect(
      page.evaluate(() => (window as any).fixture.lateDatabase()),
    ).rejects.toThrow("after the database instance has started");
  });

  test.each([
    ["no opt-in", undefined, false, false],
    ["auth only", { auth: both.auth }, true, false],
    ["database only", { rtdb: both.rtdb }, false, true],
  ] as const)(
    "%s leaves other SDKs untouched",
    async (_label, options, auth, database) => {
      const { page, errors } = await start(options);
      expect(
        await page.evaluate(() => {
          const f = (window as any).fixture;
          return {
            auth: !!f.firebaseAuth.emulatorConfig,
            database: f.database.ref(f.firebaseDatabase).toString(),
            identity: f.identity,
          };
        }),
      ).toEqual({
        auth,
        database: database
          ? "http://127.0.0.1:9000/"
          : "https://demo-gasboost.firebaseio.com/",
        identity: true,
      });
      expect(errors).toEqual([]);
    },
    30000,
  );

  test.each(["staging", "production"])(
    "%s build contains no auto-connect wrapper",
    async (mode) => {
      const output = await build({
        root,
        configFile: false,
        logLevel: "silent",
        mode,
        plugins: plugins(both),
        build: { write: false, minify: false },
      });
      const code = getBuildOutputs(output)
        .filter((item) => item.type === "chunk")
        .map((item) => item.code)
        .join("\n");
      expect(code).not.toContain("gasboost.firebase.");
      expect(code).not.toContain("namespace mismatch");
      expect(code.includes("connectAuthEmulator(instance,")).toBe(false);
    },
  );
});
