import { resolve } from "node:path";
import vm from "node:vm";
import {
  build,
  createServer,
  isRunnableDevEnvironment,
  type ViteDevServer,
} from "vite";
import { afterEach, describe, expect, test } from "vitest";
import { gasboost, type GasboostOptions } from "../src";
import { getBuildOutputs } from "./helper";
import { defaultGasRuntime } from "../src/runtime";

const entry = resolve(import.meta.dirname, "fixtures/database/main.ts");
const seed = {
  primary: {
    users: [],
    // Deliberately use a different property order from the schema.
    products: [{ price: 1000, name: "PRIVATE_SEED_PRODUCT", id: "p-1" }],
  },
  secondary: { users: [{ id: "u-2", name: "Other", enabled: false }] },
};
const servers: ViteDevServer[] = [];

afterEach(async () => {
  await Promise.all(servers.splice(0).map((server) => server.close()));
});

async function start(
  localRpc: GasboostOptions["localRpc"] = { database: seed },
) {
  const { dev } = gasboost({
    entry,
    localRpc,
    // The database-enabled case needs only the dataset configuration.
    runtime: localRpc?.database ? undefined : { Sheets: {} },
  });
  const server = await createServer({
    configFile: false,
    logLevel: "silent",
    plugins: [dev],
    server: { port: 0, host: "127.0.0.1" },
  });
  servers.push(server);
  await server.listen();
  const address = server.httpServer!.address();
  if (!address || typeof address === "string") throw new Error("No port");
  return {
    server,
    async rpc(name: string, input?: unknown) {
      const response = await fetch(
        `http://127.0.0.1:${address.port}/__gasboost/${name}`,
        {
          method: "POST",
          body: JSON.stringify({ input }),
        },
      );
      const result = await response.json();
      expect(response.status, JSON.stringify(result)).toBe(200);
      return result;
    },
  };
}

describe("Local RPC database", () => {
  test("creates in an empty table and persists across RPCs and module invalidation", async () => {
    const { server, rpc } = await start();
    expect(await rpc("users")).toEqual([]);
    const user = { id: "u-1", name: "Alice", enabled: true };
    expect(await rpc("create", user)).toEqual([user]);
    expect(await rpc("users")).toEqual([user]);
    server.environments.ssr.moduleGraph.invalidateAll();
    expect(await rpc("users")).toEqual([user]);
    expect(await rpc("products")).toEqual(seed.primary.products);
    expect(await rpc("otherUsers")).toEqual(seed.secondary.users);
    expect(await rpc("memory")).toBe(true);
    expect(await rpc("many")).toEqual({
      users: [user],
      products: seed.primary.products,
    });
    expect(await rpc("readMany")).toEqual([
      ["primary:users", [user]],
      ["secondary:users", seed.secondary.users],
    ]);
    expect(await rpc("custom")).toEqual([]);
    const updated = { ...user, enabled: false, name: "Updated" };
    await rpc("update", updated);
    expect(await rpc("users")).toEqual([updated]);
    await rpc("remove", user.id);
    expect(await rpc("users")).toEqual([]);
    expect(seed.primary.users).toEqual([]);
  });

  test("isolates servers and supports override:false", async () => {
    const first = await start({ database: seed, override: false });
    await first.rpc("create", { id: "u-1", name: "Alice", enabled: true });
    const second = await start();
    expect(await second.rpc("users")).toEqual([]);
    expect(await first.rpc("users")).toHaveLength(1);
  });

  test("does not replace the gateway when database is omitted", async () => {
    const { rpc } = await start({ override: false });
    expect(await rpc("memory")).toBe(false);
  });

  test("reports undeclared tables before the first write", async () => {
    const { server } = await start({ database: { primary: { users: [] } } });
    const environment = server.environments.ssr;
    if (!isRunnableDevEnvironment(environment))
      throw new Error("No SSR runner");
    await expect(environment.runner.import(entry)).rejects.toThrow(
      "Local RPC database table is not configured: primary:products",
    );
  });

  test("releases state when a middleware-mode server closes", async () => {
    const before = new Set(Object.getOwnPropertySymbols(globalThis));
    const { dev } = gasboost({ entry, localRpc: { database: seed } });
    const server = await createServer({
      configFile: false,
      logLevel: "silent",
      plugins: [dev],
      server: { middlewareMode: true },
    });
    servers.push(server);
    const added = Object.getOwnPropertySymbols(globalThis).filter(
      (symbol) =>
        !before.has(symbol) &&
        symbol.description?.startsWith("gasboost:database:"),
    );
    expect(added).toHaveLength(1);
    await server.close();
    expect(Object.hasOwn(globalThis, added[0])).toBe(false);
  });

  test("does not expose database code or seeds in client modules", async () => {
    const { server } = await start();
    const result = await server.environments.client.transformRequest(entry);
    expect(result?.code).not.toContain("gasboost:sheetorm");
    expect(result?.code).not.toContain("PRIVATE_SEED_PRODUCT");
    expect(result?.code).not.toContain("gasboost:database");
  });

  test("production uses the original gateway even with both plugins configured", async () => {
    const plugins = gasboost({ entry, localRpc: { database: seed } });
    const result = await build({
      configFile: false,
      logLevel: "silent",
      plugins: [plugins.build, plugins.dev],
      build: { write: false, minify: false },
    });
    const code = getBuildOutputs(result)
      .filter((output) => output.type === "chunk")
      .map((output) => output.code)
      .join("\n");
    expect(code).not.toContain("PRIVATE_SEED_PRODUCT");
    expect(code).not.toContain("gasboost:database");
    const context = vm.createContext({
      console,
      Sheets: {},
      ...defaultGasRuntime,
    });
    vm.runInContext(code, context);
    expect((await context.memory()).contents).toBe("false");
  });
});
