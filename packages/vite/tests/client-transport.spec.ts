import type { Plugin } from "vite";
import { build } from "vite";
import { describe, expect, test, vi } from "vitest";
import { gasboost } from "../src/gasboost";
import { getBuildOutputs } from "./helper";

const VIRTUAL_CLIENT_MODULE_ID = "\0gasboost:client";

function resolveIdHook(plugin: Plugin) {
  const hook = plugin.resolveId;

  if (!hook) {
    throw new Error("resolveId hook is not defined.");
  }

  return typeof hook === "function" ? hook : hook.handler;
}

function loadHook(plugin: Plugin) {
  const hook = plugin.load;

  if (!hook) {
    throw new Error("load hook is not defined.");
  }

  return typeof hook === "function" ? hook : hook.handler;
}

function createClientModuleUrl() {
  const source = `
export class FetchTransport {
  constructor(options) {
    this.endpoint = options.endpoint;
  }
}

export function appsScriptClient(options = {}) {
  return {
    options,
  };
}

export const marker = "client-export";
`;

  return `data:text/javascript;base64,${Buffer.from(source).toString("base64")}`;
}

function createContext({
  consumer,
  resolvedClientModuleId,
}: {
  consumer: "client" | "server";
  resolvedClientModuleId: string;
}) {
  const resolve = vi.fn(async () => ({
    id: resolvedClientModuleId,
  }));

  const context = {
    environment: {
      config: {
        consumer,
      },
    },
    resolve,
  };

  return {
    context,
    resolve,
  };
}

async function loadVirtualClient(plugin: Plugin) {
  const clientModuleUrl = createClientModuleUrl();

  const { context } = createContext({
    consumer: "client",
    resolvedClientModuleId: clientModuleUrl,
  });

  const resolveId = resolveIdHook(plugin);

  const resolved = await resolveId.call(
    context as never,
    "@gasboost/client",
    "/src/main.ts",
    { isEntry: false },
  );

  expect(resolved).toBe(VIRTUAL_CLIENT_MODULE_ID);

  const load = loadHook(plugin);

  const source = await load.call(
    context as never,
    VIRTUAL_CLIENT_MODULE_ID,
    {},
  );

  if (typeof source !== "string") {
    throw new Error("Virtual client module was not generated.");
  }

  const moduleUrl = `data:text/javascript;base64,${Buffer.from(source).toString(
    "base64",
  )}`;

  return import(moduleUrl);
}

describe("gasboost dev client transport", () => {
  test("client environmentでは@gasboost/clientをvirtual moduleへ差し替える", async () => {
    const { dev } = gasboost({
      entry: "src/server.ts",
    });

    const clientModuleUrl = createClientModuleUrl();

    const { context, resolve } = createContext({
      consumer: "client",
      resolvedClientModuleId: clientModuleUrl,
    });

    const resolveId = resolveIdHook(dev);

    const result = await resolveId.call(
      context as never,
      "@gasboost/client",
      "/src/main.ts",
      { isEntry: false },
    );

    expect(result).toBe(VIRTUAL_CLIENT_MODULE_ID);

    expect(resolve).toHaveBeenCalledWith(
      "@gasboost/client",
      "/src/main.ts",
      expect.objectContaining({
        skipSelf: true,
      }),
    );
  });

  test("client以外のmoduleは差し替えない", async () => {
    const { dev } = gasboost({
      entry: "src/server.ts",
    });

    const { context, resolve } = createContext({
      consumer: "client",
      resolvedClientModuleId: createClientModuleUrl(),
    });

    const resolveId = resolveIdHook(dev);

    const result = await resolveId.call(
      context as never,
      "react",
      "/src/main.ts",
      { isEntry: false },
    );

    expect(result).toBeNull();
    expect(resolve).not.toHaveBeenCalled();
  });

  test("server environmentでは@gasboost/clientを差し替えない", async () => {
    const { dev } = gasboost({
      entry: "src/server.ts",
    });

    const { context, resolve } = createContext({
      consumer: "server",
      resolvedClientModuleId: createClientModuleUrl(),
    });

    const resolveId = resolveIdHook(dev);

    const result = await resolveId.call(
      context as never,
      "@gasboost/client",
      "/src/server.ts",
      { isEntry: false },
    );

    expect(result).toBeNull();
    expect(resolve).not.toHaveBeenCalled();
  });

  test("transport未指定ではFetchTransportを自動適用する", async () => {
    const { dev } = gasboost({
      entry: "src/server.ts",
    });

    const clientModule = await loadVirtualClient(dev);

    const result = clientModule.appsScriptClient();

    expect(result.options.transport).toBeDefined();
    expect(result.options.transport.constructor.name).toBe("FetchTransport");
  });

  test("自動transportへの差し替えでもmetadataProvidersを維持する", async () => {
    const { dev } = gasboost({ entry: "src/server.ts" });
    const clientModule = await loadVirtualClient(dev);
    const metadataProviders = [() => ({ arbitrary: { value: "metadata" } })];

    const result = clientModule.appsScriptClient({ metadataProviders });

    expect(result.options.metadataProviders).toBe(metadataProviders);
    expect(result.options.transport.constructor.name).toBe("FetchTransport");
  });

  test("自動FetchTransportはLocal RPC endpointを利用する", async () => {
    const { dev } = gasboost({
      entry: "src/server.ts",
    });

    const clientModule = await loadVirtualClient(dev);

    const result = clientModule.appsScriptClient();

    expect(result.options.transport.endpoint).toBe("/__gasboost");
  });

  test("defaultでは明示transportもFetchTransportで上書きする", async () => {
    const { dev } = gasboost({
      entry: "src/server.ts",
    });

    const clientModule = await loadVirtualClient(dev);

    const transport = {
      call: vi.fn(),
    };

    const result = clientModule.appsScriptClient({
      transport,
    });

    expect(result.options.transport).not.toBe(transport);
    expect(result.options.transport.constructor.name).toBe("FetchTransport");
    expect(result.options.transport.endpoint).toBe("/__gasboost");
  });

  test("localRpc.override = falseでは明示transportを維持する", async () => {
    const { dev } = gasboost({
      entry: "src/server.ts",
      localRpc: {
        override: false,
      },
    });

    const clientModule = await loadVirtualClient(dev);

    const transport = {
      call: vi.fn(),
    };

    const result = clientModule.appsScriptClient({
      transport,
    });

    expect(result.options.transport).toBe(transport);
  });

  test("localRpc.override = falseでもtransport未指定ならFetchTransportを自動適用する", async () => {
    const { dev } = gasboost({
      entry: "src/server.ts",
      localRpc: {
        override: false,
      },
    });

    const clientModule = await loadVirtualClient(dev);

    const result = clientModule.appsScriptClient();

    expect(result.options.transport.constructor.name).toBe("FetchTransport");
    expect(result.options.transport.endpoint).toBe("/__gasboost");
  });

  test("@gasboost/clientの他exportを維持する", async () => {
    const { dev } = gasboost({
      entry: "src/server.ts",
    });

    const clientModule = await loadVirtualClient(dev);

    expect(clientModule.marker).toBe("client-export");
    expect(clientModule.FetchTransport).toBeDefined();
  });

  test("virtual module以外はloadしない", async () => {
    const { dev } = gasboost({
      entry: "src/server.ts",
    });

    const load = loadHook(dev);

    const { context } = createContext({
      consumer: "client",
      resolvedClientModuleId: createClientModuleUrl(),
    });

    const result = await load.call(context as never, "/src/main.ts", {});

    expect(result).toBeNull();
  });

  test("@gasboost/clientをresolveできない場合は差し替えない", async () => {
    const { dev } = gasboost({
      entry: "src/server.ts",
    });

    const context = {
      environment: {
        config: {
          consumer: "client",
        },
      },
      resolve: vi.fn(async () => null),
    };

    const resolveId = resolveIdHook(dev);

    const result = await resolveId.call(
      context as never,
      "@gasboost/client",
      "/src/main.ts",
      { isEntry: false },
    );

    expect(result).toBeNull();
  });
  test("production buildではFetchTransportを自動適用しない", async () => {
    const entry = new URL(
      "./fixtures/client-production/main.ts",
      import.meta.url,
    ).pathname;

    const clientEntry = new URL(
      "./fixtures/client-production/client.ts",
      import.meta.url,
    ).pathname;

    const { dev } = gasboost({
      entry: "src/server.ts",
    });

    const result = await build({
      logLevel: "silent",

      resolve: {
        alias: {
          "@gasboost/client": clientEntry,
        },
      },

      plugins: [dev],

      build: {
        minify: false,
        write: false,
        rollupOptions: {
          input: entry,
        },
      },
    });

    const output = getBuildOutputs(result)
      .filter((item) => item.type === "chunk")
      .map((item) => item.code)
      .join("\n");

    expect(output).toContain("AppsScriptTransport");
    expect(output).toContain("google.script.run");
    expect(output).not.toContain("/__gasboost");
  });
});
