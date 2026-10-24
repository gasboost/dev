import { EventEmitter } from "node:events";
import type { IncomingMessage, ServerResponse } from "node:http";
import type {
  MinimalPluginContextWithoutEnvironment,
  Plugin,
  ViteDevServer,
} from "vite";
import { describe, expect, test, vi } from "vitest";
import { gasboost } from "../src/gasboost";

vi.mock("vite", async (importOriginal) => {
  const actual = await importOriginal<typeof import("vite")>();

  return {
    ...actual,
    isRunnableDevEnvironment: () => true,
  };
});

type TestApp = {
  dispatch: ReturnType<typeof vi.fn>;
};

function createRequest({
  method = "POST",
  url = "/__gasboost/sum",
  body,
}: {
  method?: string;
  url?: string;
  body?: unknown;
}) {
  const request = new EventEmitter() as IncomingMessage;

  request.method = method;
  request.url = url;

  queueMicrotask(() => {
    if (body !== undefined) {
      request.emit("data", Buffer.from(JSON.stringify(body)));
    }

    request.emit("end");
  });

  return request;
}

function createResponse() {
  let responseBody = "";

  const response = {
    statusCode: 200,

    setHeader: vi.fn(),

    end: vi.fn((value?: string) => {
      responseBody = value ?? "";
    }),
  } as unknown as ServerResponse;

  return {
    response,

    body() {
      return responseBody;
    },
  };
}

function createServer(app: TestApp | (() => TestApp)) {
  let middleware:
    | ((
        request: IncomingMessage,
        response: ServerResponse,
        next: () => void,
      ) => void | Promise<void>)
    | undefined;

  let cachedModule:
    | {
        default: TestApp;
      }
    | undefined;

  const createApp = typeof app === "function" ? app : () => app;

  const clearCache = vi.fn(() => {
    cachedModule = undefined;
  });

  const importModule = vi.fn(async () => {
    if (!cachedModule) {
      cachedModule = {
        default: createApp(),
      };
    }

    return cachedModule;
  });

  const server = {
    middlewares: {
      use: vi.fn(
        (
          handler: (
            request: IncomingMessage,
            response: ServerResponse,
            next: () => void,
          ) => void | Promise<void>,
        ) => {
          middleware = handler;
        },
      ),
    },

    environments: {
      ssr: {
        runner: {
          clearCache,
          import: importModule,
        },
      },
    },
  };

  return {
    server,
    clearCache,
    importModule,

    middleware() {
      if (!middleware) {
        throw new Error("Middleware was not registered.");
      }

      return middleware;
    },
  };
}

function configureDevServer(plugin: Plugin, server: ViteDevServer) {
  const configureServer = plugin.configureServer;

  if (!configureServer) {
    throw new Error("configureServer is not defined.");
  }

  const context = {} as MinimalPluginContextWithoutEnvironment;

  if (typeof configureServer === "function") {
    configureServer.call(context, server);
    return;
  }

  configureServer.handler.call(context, server);
}

describe("gasboost dev", () => {
  test.each([
    {
      name: "inputとmetadata",
      input: { name: "Taro", metadata: "business-field" },
    },
    { name: "metadataのみ", input: undefined },
    { name: "null input", input: null },
  ])("$nameを分離してdispatchへ渡す", async ({ input }) => {
    const metadata = {
      "@example/tracing": { traceId: "trace-1" },
      custom: [1, null, false, { nested: "value" }],
    };
    const dispatch = vi.fn(async () => ({ contents: "true" }));
    const { dev } = gasboost({ entry: "src/server.ts" });
    const { server, middleware } = createServer({ dispatch });
    configureDevServer(dev, server as unknown as ViteDevServer);
    const { response } = createResponse();

    await middleware()(
      createRequest({ url: "/__gasboost/example", body: { input, metadata } }),
      response,
      vi.fn(),
    );

    expect(response.statusCode).toBe(200);
    expect(dispatch).toHaveBeenCalledWith("example", input, metadata);
  });

  test.each([null, [], "invalid", 1, false].map((metadata) => ({ metadata })))(
    "metadataがobjectでない場合は400を返す: $metadata",
    async ({ metadata }) => {
      const dispatch = vi.fn();
      const { dev } = gasboost({ entry: "src/server.ts" });
      const { server, middleware, importModule } = createServer({ dispatch });
      configureDevServer(dev, server as unknown as ViteDevServer);
      const { response, body } = createResponse();

      await middleware()(
        createRequest({ body: { input: {}, metadata } }),
        response,
        vi.fn(),
      );

      expect(response.statusCode).toBe(400);
      expect(JSON.parse(body()).error).toMatchObject({
        name: "InvalidRpcRequestError",
        message: "Invalid RPC request body. Expected metadata to be an object.",
      });
      expect(importModule).not.toHaveBeenCalled();
      expect(dispatch).not.toHaveBeenCalled();
    },
  );

  test("POST RPCを実行できる", async () => {
    const dispatch = vi.fn(async () => ({
      contents: JSON.stringify(3),
    }));

    const { dev } = gasboost({
      entry: "src/server.ts",
    });

    const { server, middleware, importModule } = createServer({
      dispatch,
    });

    configureDevServer(dev, server as unknown as ViteDevServer);

    const input = {
      a: 1,
      b: 2,
    };

    const request = createRequest({
      body: {
        input,
      },
    });

    const { response, body } = createResponse();

    const next = vi.fn();

    await middleware()(request, response, next);

    expect(importModule).toHaveBeenCalledWith("src/server.ts");

    expect(dispatch).toHaveBeenCalledWith("sum", input);

    expect(response.statusCode).toBe(200);

    expect(body()).toBe("3");

    expect(next).not.toHaveBeenCalled();
  });

  test("object inputをRPC handlerへ渡せる", async () => {
    const dispatch = vi.fn(async () => ({
      contents: JSON.stringify("ok"),
    }));

    const { dev } = gasboost({
      entry: "src/server.ts",
    });

    const { server, middleware } = createServer({
      dispatch,
    });

    configureDevServer(dev, server as unknown as ViteDevServer);

    const input = {
      id: "123",
      enabled: true,
      nested: {
        value: 4,
      },
    };

    const request = createRequest({
      url: "/__gasboost/example",
      body: {
        input,
      },
    });

    const { response } = createResponse();

    await middleware()(request, response, vi.fn());

    expect(dispatch).toHaveBeenCalledWith("example", input);
  });

  test("async RPCを実行できる", async () => {
    const dispatch = vi.fn(async () => {
      await Promise.resolve();

      return {
        contents: JSON.stringify("done"),
      };
    });

    const { dev } = gasboost({
      entry: "src/server.ts",
    });

    const { server, middleware } = createServer({
      dispatch,
    });

    configureDevServer(dev, server as unknown as ViteDevServer);

    const request = createRequest({
      url: "/__gasboost/async",
      body: {},
    });

    const { response, body } = createResponse();

    await middleware()(request, response, vi.fn());

    expect(body()).toBe(JSON.stringify("done"));
  });

  test("AppsScriptResponseのcontentsをそのまま返す", async () => {
    const result = {
      name: "Alice",
      items: [1, 2, 3],
    };

    const dispatch = vi.fn(async () => ({
      contents: JSON.stringify(result),
    }));

    const { dev } = gasboost({
      entry: "src/server.ts",
    });

    const { server, middleware } = createServer({
      dispatch,
    });

    configureDevServer(dev, server as unknown as ViteDevServer);

    const request = createRequest({
      url: "/__gasboost/getData",
      body: {},
    });

    const { response, body } = createResponse();

    await middleware()(request, response, vi.fn());

    expect(response.statusCode).toBe(200);

    expect(body()).toBe(JSON.stringify(result));

    expect(response.setHeader).toHaveBeenCalledWith(
      "Content-Type",
      "application/json; charset=utf-8",
    );
  });

  test("対象外pathはnextする", async () => {
    const dispatch = vi.fn();

    const { dev } = gasboost({
      entry: "src/server.ts",
    });

    const { server, middleware, importModule } = createServer({
      dispatch,
    });

    configureDevServer(dev, server as unknown as ViteDevServer);

    const request = createRequest({
      url: "/api/users",
    });

    const { response } = createResponse();

    const next = vi.fn();

    await middleware()(request, response, next);

    expect(next).toHaveBeenCalledOnce();

    expect(importModule).not.toHaveBeenCalled();

    expect(dispatch).not.toHaveBeenCalled();
  });

  test("RPC名が空ならnextする", async () => {
    const dispatch = vi.fn();

    const { dev } = gasboost({
      entry: "src/server.ts",
    });

    const { server, middleware } = createServer({
      dispatch,
    });

    configureDevServer(dev, server as unknown as ViteDevServer);

    const request = createRequest({
      url: "/__gasboost/",
    });

    const { response } = createResponse();

    const next = vi.fn();

    await middleware()(request, response, next);

    expect(next).toHaveBeenCalledOnce();

    expect(dispatch).not.toHaveBeenCalled();
  });

  test("ネストしたpathはRPCとして扱わない", async () => {
    const dispatch = vi.fn();

    const { dev } = gasboost({
      entry: "src/server.ts",
    });

    const { server, middleware } = createServer({
      dispatch,
    });

    configureDevServer(dev, server as unknown as ViteDevServer);

    const request = createRequest({
      url: "/__gasboost/foo/bar",
    });

    const { response } = createResponse();

    const next = vi.fn();

    await middleware()(request, response, next);

    expect(next).toHaveBeenCalledOnce();

    expect(dispatch).not.toHaveBeenCalled();
  });

  test("POST以外は405を返す", async () => {
    const dispatch = vi.fn();

    const { dev } = gasboost({
      entry: "src/server.ts",
    });

    const { server, middleware } = createServer({
      dispatch,
    });

    configureDevServer(dev, server as unknown as ViteDevServer);

    const request = createRequest({
      method: "GET",
    });

    const { response, body } = createResponse();

    await middleware()(request, response, vi.fn());

    expect(response.statusCode).toBe(405);

    expect(JSON.parse(body())).toMatchObject({
      error: {
        name: "MethodNotAllowedError",
        message: "Only POST is allowed.",
      },
    });

    expect(dispatch).not.toHaveBeenCalled();
  });

  test("空bodyではinputなしでRPCを実行する", async () => {
    const dispatch = vi.fn(async () => ({
      contents: JSON.stringify("ok"),
    }));

    const { dev } = gasboost({
      entry: "src/server.ts",
    });

    const { server, middleware } = createServer({
      dispatch,
    });

    configureDevServer(dev, server as unknown as ViteDevServer);

    const request = createRequest({
      url: "/__gasboost/noInput",
      body: undefined,
    });

    const { response } = createResponse();

    await middleware()(request, response, vi.fn());

    expect(dispatch).toHaveBeenCalledWith("noInput", undefined);
  });

  test("空objectではinputなしでRPCを実行する", async () => {
    const dispatch = vi.fn(async () => ({
      contents: JSON.stringify("ok"),
    }));

    const { dev } = gasboost({
      entry: "src/server.ts",
    });

    const { server, middleware } = createServer({
      dispatch,
    });

    configureDevServer(dev, server as unknown as ViteDevServer);

    const request = createRequest({
      url: "/__gasboost/noInput",
      body: {},
    });

    const { response } = createResponse();

    await middleware()(request, response, vi.fn());

    expect(dispatch).toHaveBeenCalledWith("noInput", undefined);
  });

  test("bodyがobjectでなければ400を返す", async () => {
    const dispatch = vi.fn();

    const { dev } = gasboost({
      entry: "src/server.ts",
    });

    const { server, middleware } = createServer({
      dispatch,
    });

    configureDevServer(dev, server as unknown as ViteDevServer);

    const request = createRequest({
      body: "invalid",
    });

    const { response, body } = createResponse();

    await middleware()(request, response, vi.fn());

    expect(response.statusCode).toBe(400);

    expect(JSON.parse(body())).toMatchObject({
      error: {
        name: "InvalidRpcRequestError",
        message: "Invalid RPC request body. Expected an object.",
      },
    });

    expect(dispatch).not.toHaveBeenCalled();
  });

  test("未登録RPCの例外をJSONで返す", async () => {
    const dispatch = vi.fn(async () => {
      throw new Error("Function unknown is not registered.");
    });

    const { dev } = gasboost({
      entry: "src/server.ts",
    });

    const { server, middleware } = createServer({
      dispatch,
    });

    configureDevServer(dev, server as unknown as ViteDevServer);

    const request = createRequest({
      url: "/__gasboost/unknown",
      body: {},
    });

    const { response, body } = createResponse();

    await middleware()(request, response, vi.fn());

    expect(response.statusCode).toBe(500);

    expect(JSON.parse(body())).toMatchObject({
      error: {
        name: "Error",
        message: "Function unknown is not registered.",
      },
    });
  });

  test("handler例外をJSONで返す", async () => {
    const dispatch = vi.fn(async () => {
      throw new TypeError("handler failed");
    });

    const { dev } = gasboost({
      entry: "src/server.ts",
    });

    const { server, middleware } = createServer({
      dispatch,
    });

    configureDevServer(dev, server as unknown as ViteDevServer);

    const request = createRequest({
      url: "/__gasboost/fail",
      body: {},
    });

    const { response, body } = createResponse();

    await middleware()(request, response, vi.fn());

    expect(response.statusCode).toBe(500);

    expect(JSON.parse(body())).toMatchObject({
      error: {
        name: "TypeError",
        message: "handler failed",
      },
    });
  });

  test("query string付きでもRPC名を取得できる", async () => {
    const dispatch = vi.fn(async () => ({
      contents: JSON.stringify("ok"),
    }));

    const { dev } = gasboost({
      entry: "src/server.ts",
    });

    const { server, middleware } = createServer({
      dispatch,
    });

    configureDevServer(dev, server as unknown as ViteDevServer);

    const input = {
      name: "Taro",
    };

    const request = createRequest({
      url: "/__gasboost/hello?foo=bar",
      body: {
        input,
      },
    });

    const { response } = createResponse();

    await middleware()(request, response, vi.fn());

    expect(dispatch).toHaveBeenCalledWith("hello", input);
  });

  test("URL encoded RPC名をdecodeする", async () => {
    const dispatch = vi.fn(async () => ({
      contents: JSON.stringify("ok"),
    }));

    const { dev } = gasboost({
      entry: "src/server.ts",
    });

    const { server, middleware } = createServer({
      dispatch,
    });

    configureDevServer(dev, server as unknown as ViteDevServer);

    const request = createRequest({
      url: "/__gasboost/hello%20world",
      body: {},
    });

    const { response } = createResponse();

    await middleware()(request, response, vi.fn());

    expect(dispatch).toHaveBeenCalledWith("hello world", undefined);
  });

  test("RPCごとにmodule cacheを破棄してserver entryを再評価する", async () => {
    const dispatch = vi.fn(async () => ({
      contents: JSON.stringify("ok"),
    }));

    const { dev } = gasboost({
      entry: "src/server.ts",
    });

    const { server, middleware, clearCache, importModule } = createServer({
      dispatch,
    });

    configureDevServer(dev, server as unknown as ViteDevServer);

    const { response: response1 } = createResponse();

    await middleware()(
      createRequest({
        url: "/__gasboost/first",
        body: {},
      }),
      response1,
      vi.fn(),
    );

    const { response: response2 } = createResponse();

    await middleware()(
      createRequest({
        url: "/__gasboost/second",
        body: {},
      }),
      response2,
      vi.fn(),
    );

    expect(clearCache).toHaveBeenCalledTimes(2);
    expect(importModule).toHaveBeenCalledTimes(2);

    expect(importModule).toHaveBeenNthCalledWith(1, "src/server.ts");
    expect(importModule).toHaveBeenNthCalledWith(2, "src/server.ts");

    expect(clearCache.mock.invocationCallOrder[0]).toBeLessThan(
      importModule.mock.invocationCallOrder[0],
    );

    expect(clearCache.mock.invocationCallOrder[1]).toBeLessThan(
      importModule.mock.invocationCallOrder[1],
    );
  });

  test("RPC invocation間でapplication stateを共有しない", async () => {
    const instances: Array<{
      session?: string;
    }> = [];

    const { dev } = gasboost({
      entry: "src/server.ts",
    });

    const { server, middleware } = createServer(() => {
      const state: {
        session?: string;
      } = {};

      instances.push(state);

      return {
        dispatch: vi.fn(async (name: string, input: unknown) => {
          if (name === "privateRpc") {
            state.session = (input as { session: string }).session;
          }

          return {
            contents: JSON.stringify(state.session ?? null),
          };
        }),
      };
    });

    configureDevServer(dev, server as unknown as ViteDevServer);

    const privateResponse = createResponse();

    await middleware()(
      createRequest({
        url: "/__gasboost/privateRpc",
        body: {
          input: {
            session: "User A",
          },
        },
      }),
      privateResponse.response,
      vi.fn(),
    );

    expect(privateResponse.body()).toBe(JSON.stringify("User A"));

    const publicResponse = createResponse();

    await middleware()(
      createRequest({
        url: "/__gasboost/publicRpc",
        body: {},
      }),
      publicResponse.response,
      vi.fn(),
    );

    expect(publicResponse.body()).toBe(JSON.stringify(null));

    expect(instances).toHaveLength(2);
    expect(instances[0]).not.toBe(instances[1]);
  });

  test("異なるuserのRPC invocation間でstateを混在させない", async () => {
    const { dev } = gasboost({
      entry: "src/server.ts",
    });

    const { server, middleware } = createServer(() => {
      const state: {
        session?: string;
      } = {};

      return {
        dispatch: vi.fn(async (name: string, input: unknown) => {
          if (name === "authenticate") {
            state.session = (input as { session: string }).session;
          }

          return {
            contents: JSON.stringify(state.session ?? null),
          };
        }),
      };
    });

    configureDevServer(dev, server as unknown as ViteDevServer);

    const userAResponse = createResponse();

    await middleware()(
      createRequest({
        url: "/__gasboost/authenticate",
        body: {
          input: {
            session: "User A",
          },
        },
      }),
      userAResponse.response,
      vi.fn(),
    );

    expect(userAResponse.body()).toBe(JSON.stringify("User A"));

    const userBResponse = createResponse();

    await middleware()(
      createRequest({
        url: "/__gasboost/authenticate",
        body: {
          input: {
            session: "User B",
          },
        },
      }),
      userBResponse.response,
      vi.fn(),
    );

    expect(userBResponse.body()).toBe(JSON.stringify("User B"));

    const publicResponse = createResponse();

    await middleware()(
      createRequest({
        url: "/__gasboost/publicRpc",
        body: {},
      }),
      publicResponse.response,
      vi.fn(),
    );

    expect(publicResponse.body()).toBe(JSON.stringify(null));
  });
});
