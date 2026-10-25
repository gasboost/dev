import { spawn, type ChildProcess } from "node:child_process";
import { once } from "node:events";
import { resolve } from "node:path";
import vm from "node:vm";
import {
  InMemoryCacheService,
  InMemoryPropertiesService,
} from "@gasboost/fake-core";
import { NodeUrlFetchApp } from "@gasboost/fake-node";
import * as original from "@gasboost/realtime-firebase";
import { versionPath } from "@gasboost/realtime-firebase/client";
import { afterEach, describe, expect, test, vi } from "vitest";
import {
  build,
  createServer,
  isRunnableDevEnvironment,
  type ViteDevServer,
} from "vite";
import { gasboost, type GasboostOptions } from "../src";
import { defaultGasRuntime } from "../src/runtime";
import { getBuildOutputs } from "./helper";

const entry = resolve(import.meta.dirname, "fixtures/rtdb/main.ts");
const seed = { primary: { employees: [] } };
const servers: ViteDevServer[] = [];
const children: ChildProcess[] = [];

function childExited(child: ChildProcess): Promise<void> {
  return new Promise((resolve, reject) => {
    child.once("exit", () => resolve());
    child.once("error", reject);
  });
}

afterEach(async () => {
  await Promise.all(servers.splice(0).map((server) => server.close()));
  await Promise.all(
    children.splice(0).map(async (child) => {
      if (child.exitCode !== null || child.signalCode !== null) return;
      const exited = childExited(child);
      child.kill();
      await exited;
    }),
  );
});

async function emulatorServer() {
  // Synchronous GAS HTTP runs on the parent thread, so serve HTTP in a child.
  const child = spawn(
    process.execPath,
    [resolve(import.meta.dirname, "fixtures/rtdb/emulator-server.mjs")],
    {
      stdio: ["ignore", "pipe", "inherit"],
    },
  );
  children.push(child);
  const [chunk] = await Promise.race([
    once(child.stdout!, "data"),
    childExited(child).then(() => {
      throw new Error("HTTP fixture exited before startup");
    }),
  ]);
  const port = Number(String(chunk));
  if (!Number.isInteger(port) || port < 1)
    throw new Error("No HTTP fixture port");
  return {
    child,
    port,
    requests: async () =>
      (await fetch(`http://127.0.0.1:${port}/requests`)).json(),
  };
}

async function start(
  rtdb: NonNullable<GasboostOptions["localRpc"]>["rtdb"],
  runtime: GasboostOptions["runtime"] = {},
  database = true,
) {
  const plugins = gasboost({
    entry,
    localRpc: {
      ...(database ? { database: seed } : {}),
      override: false,
      rtdb,
    },
    runtime: {
      PropertiesService: new InMemoryPropertiesService(),
      CacheService: new InMemoryCacheService(),
      // Test the opt-in default UrlFetchApp; provide it only when opted out.
      ...(rtdb ? {} : { UrlFetchApp: new NodeUrlFetchApp() }),
      ...(database ? {} : { Sheets: {} }),
      ...runtime,
    },
  });
  const server = await createServer({
    configFile: false,
    logLevel: "silent",
    plugins: [plugins.dev],
    server: { port: 0, host: "127.0.0.1" },
  });
  servers.push(server);
  await server.listen();
  const address = server.httpServer!.address();
  if (!address || typeof address === "string") throw new Error("No Vite port");
  return {
    server,
    async rpc(name: string, input?: unknown, status = 200) {
      const response = await fetch(
        `http://127.0.0.1:${address.port}/__gasboost/${name}`,
        {
          method: "POST",
          body: JSON.stringify({ input }),
        },
      );
      const body = await response.json();
      expect(response.status, JSON.stringify(body)).toBe(status);
      return body;
    },
  };
}

describe("Local RPC RTDB emulator", () => {
  test("unmodified SheetDB afterCommit publishes real HTTP PATCHes without production credentials", async () => {
    const emulator = await emulatorServer();
    const namespace = "demo-vite namespace";
    const { server, rpc } = await start({
      emulator: { namespace, port: emulator.port },
    });
    const employee = { id: "e-1", name: "Taro" };
    expect(await rpc("createEmployee", employee)).toEqual([employee]);
    expect(await rpc("listEmployees")).toEqual([employee]);
    await rpc("createEmployee", { id: "e-2", name: "Hanako" });
    const requests = await emulator.requests();
    expect(requests).toHaveLength(2);
    for (const [index, request] of requests.entries()) {
      expect(request.url).toBe(`/.json?ns=${encodeURIComponent(namespace)}`);
      expect(request.method).toBe("PATCH");
      expect(request.headers.authorization).toBe("Bearer owner");
      expect(JSON.parse(request.payload)).toEqual({
        "syncVersions/employees": index + 1,
      });
    }
    const environment = server.environments.ssr;
    if (!isRunnableDevEnvironment(environment))
      throw new Error("No SSR runner");
    const module = await environment.runner.import(entry);
    expect(module.FirebaseRtdb).toBe(original.FirebaseRtdb);
    expect(module.FirebaseCustomToken).toBe(original.FirebaseCustomToken);
    expect(module.PropertiesVersionStore).toBe(original.PropertiesVersionStore);
    expect(module.versionPath).toBe(versionPath);
  });

  test("uses default host/port and the constructor's injected urlFetchApp", async () => {
    const fetch = vi.fn(() => ({
      getResponseCode: () => 200,
      getContentText: () => "{}",
    }));
    const { rpc } = await start(
      { emulator: { namespace: "demo-defaults" } },
      { UrlFetchApp: { fetch } },
    );
    expect(await rpc("publishOnly")).toBe(true);
    expect(fetch).toHaveBeenCalledExactlyOnceWith(
      "http://127.0.0.1:9000/.json?ns=demo-defaults",
      expect.objectContaining({
        method: "patch",
        headers: { Authorization: "Bearer owner" },
      }),
    );
  });

  test("propagates HTTP errors and never falls back to production", async () => {
    const emulator = await emulatorServer();
    const { rpc } = await start({
      emulator: {
        namespace: "rejected",
        host: "localhost",
        port: emulator.port,
      },
    });
    const body = await rpc("publishOnly", undefined, 500);
    expect(body.error.message).toContain("RTDB Emulator PATCH failed");
    expect(body.error.message).toContain("HTTP 503");
    expect(body.error.message).toContain("emulator unavailable");
    expect(await emulator.requests()).toHaveLength(1);
  });

  test("reports an unavailable emulator with its configured target", async () => {
    const emulator = await emulatorServer();
    const exited = childExited(emulator.child);
    emulator.child.kill();
    await exited;
    const { rpc } = await start({
      emulator: { namespace: "offline", port: emulator.port },
    });
    const body = await rpc("publishOnly", undefined, 500);
    expect(body.error.message).toContain(
      `Local RPC RTDB Emulator PATCH failed (127.0.0.1:${emulator.port}, namespace=offline)`,
    );
    expect(body.error.message).not.toContain("Production credentials");
  });

  test("keeps production transport when emulator is omitted", async () => {
    const { rpc } = await start(undefined);
    expect((await rpc("publishOnly", undefined, 500)).error.message).toBe(
      "Production credentials were accessed",
    );
  });

  test("can enable RTDB without the SheetORM database option", async () => {
    const emulator = await emulatorServer();
    const { rpc } = await start(
      { emulator: { namespace: "standalone", port: emulator.port } },
      {},
      false,
    );
    expect(await rpc("publishOnly")).toBe(true);
    expect(await emulator.requests()).toHaveLength(1);
  });

  test("does not replace browser root or client subpath imports", async () => {
    const { server } = await start({
      emulator: { namespace: "browser-only-sentinel" },
    });
    const transformed =
      await server.environments.client.transformRequest(entry);
    expect(transformed?.code).not.toContain("gasboost:rtdb");
    expect(transformed?.code).not.toContain("browser-only-sentinel");
    expect(transformed?.code).not.toContain("FirebaseRtdbEmulatorTransport");
  });

  test("production build keeps the original transport and excludes emulator code", async () => {
    const plugins = gasboost({
      entry,
      localRpc: {
        rtdb: { emulator: { namespace: "production-build-sentinel" } },
      },
    });
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
    expect(code).not.toContain("FirebaseRtdbEmulatorTransport");
    expect(code).not.toContain("production-build-sentinel");
    const context = vm.createContext({
      ...defaultGasRuntime,
      PropertiesService: new InMemoryPropertiesService(),
      CacheService: new InMemoryCacheService(),
      Sheets: {},
      UrlFetchApp: {},
      exports: {},
    });
    vm.runInContext(code, context);
    await expect(context.publishOnly()).rejects.toThrow(
      "Production credentials were accessed",
    );
  });
});
