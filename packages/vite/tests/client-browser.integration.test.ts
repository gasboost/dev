import { chromium, type Browser } from "@playwright/test";
import { createRequire } from "node:module";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { resolve } from "node:path";
import { afterAll, beforeAll, expect, test } from "vitest";
import { build, createServer } from "vite";
import { gasboost } from "../src";
import { getBuildOutputs } from "./helper";

const root = resolve(import.meta.dirname, "fixtures/client-browser");

const require = createRequire(import.meta.url);
let browser: Browser;
beforeAll(async () => {
  browser = await chromium.launch({ headless: true });
});
afterAll(async () => {
  await browser?.close();
});

test.each([
  { override: undefined, customTransport: false },
  { override: undefined, customTransport: true },
  { override: false, customTransport: false },
  { override: false, customTransport: true },
])(
  "CommonJS client in Vite: $override / custom transport $customTransport",
  async ({ override, customTransport }) => {
    // Exercise the published CommonJS package through Vite's browser optimizer.
    expect(await readFile(require.resolve("@gasboost/client"), "utf8")).toContain(
      'Object.defineProperty(exports, "AppsScriptRpcError"',
    );
    const cacheDir = await mkdtemp(resolve(tmpdir(), "gasboost-client-"));
    const server = await createServer({
      root,
      cacheDir,
      configFile: false,
      logLevel: "silent",
      plugins: [gasboost({ entry: "unused.ts", localRpc: { override } }).dev],
      server: { host: "127.0.0.1", port: 0 },
    });
    const context = await browser.newContext();
    try {
      await server.listen();
      const requests: unknown[] = [];
      let fail = false;
      await context.route("**/__gasboost/echo", async (route) => {
        requests.push(route.request().postDataJSON());
        await route.fulfill({
          status: fail ? 403 : 200,
          contentType: "application/json",
          body: JSON.stringify(
            fail
              ? { error: { code: "UNAUTHORIZED", message: "Invalid token" } }
              : "local",
          ),
        });
      });
      const page = await context.newPage();
      const errors: string[] = [];
      page.on("pageerror", (error) => errors.push(error.message));
      await page.goto(server.resolvedUrls!.local[0]);
      // Keep import() in browser source so Vitest does not rewrite it for SSR.
      const exports = await page.evaluate(`import("/main.ts").then(({ api }) =>
        Object.fromEntries(Object.entries(api).map(([name, value]) => [name, typeof value]))
      )`);
      expect(exports).toEqual(
        Object.fromEntries(
          Object.entries(require("@gasboost/client")).map(([name, value]) => [
            name,
            typeof value,
          ]),
        ),
      );
      const call = () =>
        page.evaluate(
          `import("/main.ts").then((module) => module.call(${customTransport}))`,
        );
      const preserveCustom = override === false && customTransport;
      expect(await call()).toEqual({ result: preserveCustom ? "custom" : "local" });
      fail = true;
      expect(await call()).toEqual(
        preserveCustom
          ? { result: "custom" }
          : { code: "UNAUTHORIZED", message: "Invalid token" },
      );
      expect(requests).toEqual(
        preserveCustom
          ? []
          : Array(2).fill({
              input: { value: 42 },
              metadata: { base: true, scoped: true },
            }),
      );
      expect(errors).toEqual([]);
    } finally {
      await context.close();
      await server.close();
      await rm(cacheDir, { recursive: true, force: true });
    }
  },
  30000,
);

test("production build keeps the published client and AppsScriptTransport", async () => {
  const output = await build({
    root,
    configFile: false,
    logLevel: "silent",
    plugins: [gasboost({ entry: "unused.ts" }).dev],
    build: {
      write: false,
      minify: false,
      lib: { entry: resolve(root, "main.ts"), formats: ["es"] },
    },
  });
  const code = getBuildOutputs(output)
    .filter((item) => item.type === "chunk")
    .map((item) => item.code)
    .join("\n");
  expect(code).toContain("AppsScriptRpcError");
  expect(code).toContain("google.script.run");
  expect(code).not.toContain("/__gasboost");
  expect(code).not.toContain("originalAppsScriptClient");
});
